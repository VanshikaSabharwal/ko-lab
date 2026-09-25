import { getServerSession } from "next-auth";
import prisma from "../../lib/prisma";
import { authOptions } from "../../lib/auth";
import { Groq } from "groq-sdk";
import {
  CREDITS_PER_CONVERSATION,
  type AssistantCredits,
} from "../../lib/assistantCredits";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Tool definitions for Groq's OpenAI-compatible tool format
const tools = [
  {
    type: "function",
    function: {
      name: "list_my_groups",
      description:
        "List all groups the user owns or is a member of, with recent activity",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_tasks",
      description: "List planning tasks assigned to the user across all groups",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_group_activity",
      description:
        "Get recent changes, messages, and pull requests in a specific group",
      parameters: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "The group ID to fetch activity for",
          },
          limit: {
            type: "number",
            description: "Number of recent items to return (default 10)",
            default: 10,
          },
        },
        required: ["group_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_blocked_by",
      description:
        "Get dependency graph for a task (what tasks are blocking it)",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The planning task ID",
          },
        },
        required: ["task_id"],
      },
    },
  },
];

// Without this the model treats the user as the developer and narrates
// internal failures (Prisma errors, schema advice) back to them.
const SYSTEM_PROMPT = `You are the Ko-Lab Assistant, built into Ko-Lab, a platform for collaborative coding, group chat, and task planning.

You're talking to a Ko-Lab user, not a developer. Use the tools to answer questions about their groups, tasks, and recent activity.

Formatting:
- Reply in Markdown. Keep it short and easy to scan.
- Start with a one-line summary, then use short sections (### headings) or bullet lists when there's more than one item.
- Put group, file, and task names in **bold**. Show dates in a readable form like "Sep 23".
- Use a Markdown table when listing several items that share fields, such as tasks. Put the table on its own lines with a blank line before and after it.
- For tasks, use the columns: Task | Priority | Due | Group. Write the priority as plain High, Medium, or Low (not bold), write the due date like "Sep 10", and write "—" for missing values.
- Never show IDs (the long strings like "cmu0…"), code, JSON, or technical details unless the user asks for them. Keep IDs to yourself for follow-up tool calls.

For "What did I miss?", list the user's groups, then check the activity of their most active groups and summarize new change requests and file changes, grouped by group.

If a tool returns an error, don't explain or debug it. Say briefly that you couldn't load that information right now, and answer with whatever else you have.`;

type ToolName = "list_my_groups" | "list_my_tasks" | "get_group_activity" | "get_blocked_by";

interface ToolInput {
  group_id?: string;
  task_id?: string;
  limit?: number;
}

async function executeToolCall(
  toolName: ToolName,
  toolInput: ToolInput,
  userId: string
): Promise<unknown> {
  try {
    switch (toolName) {
      case "list_my_groups": {
        // Get all groups where user is owner or member
        const groups = await prisma.group.findMany({
          where: {
            OR: [{ ownerId: userId }, { members: { some: { userId } } }],
          },
          select: {
            id: true,
            groupName: true,
            description: true,
            ownerId: true,
            _count: {
              select: { members: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        });
        return groups.map((g) => ({
          id: g.id,
          name: g.groupName,
          description: g.description,
          isOwner: g.ownerId === userId,
          memberCount: g._count.members,
        }));
      }

      case "list_my_tasks": {
        // Get planning tasks assigned to the user via PlanningAssignee join table
        const tasks = await prisma.planningTask.findMany({
          where: {
            assignees: { some: { userId } },
            group: {
              OR: [{ ownerId: userId }, { members: { some: { userId } } }],
            },
          },
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            dueDate: true,
            groupId: true,
            group: { select: { groupName: true } },
          },
          orderBy: { dueDate: "asc" },
          take: 15,
        });
        return tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          dueDate: t.dueDate,
          group: t.group.groupName,
        }));
      }

      case "get_group_activity": {
        // Verify user is a member or owner
        const groupId = toolInput.group_id;
        if (!groupId) throw new Error("group_id is required");

        const group = await prisma.group.findFirst({
          where: {
            id: groupId,
            OR: [{ ownerId: userId }, { members: { some: { userId } } }],
          },
          select: {
            id: true,
            groupName: true,
          },
        });

        if (!group) {
          throw new Error("User is not a member of this group");
        }

        const limit = toolInput.limit || 10;

        // Fetch recent changes from files modified in this group
        const recentChanges = await prisma.change.findMany({
          where: {
            file: { groupId },
          },
          select: {
            id: true,
            type: true,
            lineNumber: true,
            content: true,
            createdAt: true,
            file: {
              select: {
                name: true,
                modifiedBy: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        // Fetch recent change requests
        const recentCRs = await prisma.changeRequest.findMany({
          where: { groupId },
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            author: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        });

        return {
          groupId,
          groupName: group.groupName,
          recentFileChanges: recentChanges.map((c) => ({
            file: c.file.name,
            type: c.type,
            line: c.lineNumber,
            changedBy: c.file.modifiedBy?.name || "unknown",
            createdAt: c.createdAt,
          })),
          recentChangeRequests: recentCRs.map((cr) => ({
            id: cr.id,
            title: cr.title,
            status: cr.status,
            author: cr.author.name,
            createdAt: cr.createdAt,
          })),
        };
      }

      case "get_blocked_by": {
        // Fetch blocking tasks for a given task via PlanningTaskDependency
        const taskId = toolInput.task_id;
        if (!taskId) throw new Error("task_id is required");

        // Scoped to the user's groups, like list_my_tasks — a task id alone
        // must not expose another group's planning
        const task = await prisma.planningTask.findFirst({
          where: {
            id: taskId,
            group: {
              OR: [{ ownerId: userId }, { members: { some: { userId } } }],
            },
          },
          select: {
            id: true,
            title: true,
            blockedBy: {
              select: {
                blocker: {
                  select: {
                    id: true,
                    title: true,
                    priority: true,
                  },
                },
              },
            },
          },
        });

        if (!task) throw new Error("Task not found");

        return {
          taskId,
          title: task.title,
          blockedBy: task.blockedBy.map((dep) => dep.blocker),
        };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type SpendResult =
  | { ok: true; credits: AssistantCredits }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "exhausted"; credits: AssistantCredits };

/**
 * Spends one credit on the conversation. The guard lives in the UPDATE's
 * WHERE clause, so two requests racing for the last credit can't both win.
 */
async function spendCredit(conversationId: string, userId: string): Promise<SpendResult> {
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id: conversationId, userId },
    select: { creditsTotal: true },
  });
  if (!conversation) return { ok: false, reason: "not_found" };

  const { count } = await prisma.assistantConversation.updateMany({
    where: {
      id: conversationId,
      userId,
      creditsUsed: { lt: conversation.creditsTotal },
    },
    data: { creditsUsed: { increment: 1 } },
  });

  const after = await prisma.assistantConversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { creditsTotal: true, creditsUsed: true },
  });
  const credits = {
    total: after.creditsTotal,
    used: after.creditsUsed,
    remaining: Math.max(0, after.creditsTotal - after.creditsUsed),
  };

  return count === 0 ? { ok: false, reason: "exhausted", credits } : { ok: true, credits };
}

async function runAssistant(
  messages: { role: string; content: string }[],
  userId: string
): Promise<{ text: string; finishReason: string | undefined }> {
  // Accumulates across tool rounds so later calls still see earlier results
  const conversation: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let response = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b", // High-quality open-source model on Groq
    messages: conversation,
    tools: tools as unknown as Groq.Chat.ChatCompletionTool[],
    tool_choice: "auto",
    max_tokens: 1024,
  });

  // Handle tool calls in a simple loop (no nested loops for this phase)
  let iterations = 0;
  const maxIterations = 5;

  while (
    response.choices[0]?.finish_reason === "tool_calls" &&
    iterations < maxIterations
  ) {
    iterations++;

    const toolCalls = response.choices[0].message.tool_calls || [];

    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        if (toolCall.type !== "function") {
          return {
            tool_call_id: toolCall.id,
            result: { error: "Invalid tool type" },
          };
        }

        const toolName = toolCall.function.name as ToolName;
        const toolInput = JSON.parse(toolCall.function.arguments) as ToolInput;
        const result = await executeToolCall(toolName, toolInput, userId);

        return {
          tool_call_id: toolCall.id,
          result,
        };
      })
    );

    conversation.push({
      role: "assistant",
      content: response.choices[0].message.content,
      tool_calls: toolCalls,
    });

    // Add tool results (OpenAI/Groq format: role:tool with string content)
    toolResults.forEach((tr) => {
      if ("error" in (tr.result as object)) {
        console.error("Assistant tool error:", tr.tool_call_id, tr.result);
      }
      conversation.push({
        role: "tool",
        tool_call_id: tr.tool_call_id,
        content: JSON.stringify(tr.result),
      });
    });

    // Continue conversation
    response = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: conversation,
      tools: tools as unknown as Groq.Chat.ChatCompletionTool[],
      tool_choice: "auto",
      max_tokens: 1024,
    });
  }

  return {
    text: response.choices[0]?.message.content || "",
    finishReason: response.choices[0]?.finish_reason,
  };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const { messages } = body;

    if (!process.env.GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid messages format" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const userId = session.user.id;

    // Validate message format
    if (!messages.every((m: any) => m.role && m.content)) {
      return new Response(
        JSON.stringify({ error: "Invalid message format: each message must have role and content" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // A conversation is created on its first message; later messages must
    // name one the user owns.
    let conversationId: string;
    if (body.conversationId == null) {
      const created = await prisma.assistantConversation.create({
        data: { userId, creditsTotal: CREDITS_PER_CONVERSATION },
        select: { id: true },
      });
      conversationId = created.id;
    } else if (typeof body.conversationId === "string") {
      conversationId = body.conversationId;
    } else {
      return json({ error: "Invalid conversationId" }, 400);
    }

    const spent = await spendCredit(conversationId, userId);
    if (!spent.ok) {
      return spent.reason === "not_found"
        ? json({ error: "Conversation not found" }, 404)
        : json(
            {
              error: "This conversation has used all its credits. Start a new chat to keep going.",
              code: "OUT_OF_CREDITS",
              conversationId,
              credits: spent.credits,
            },
            402
          );
    }

    let result: { text: string; finishReason: string | undefined };
    try {
      result = await runAssistant(messages, userId);
    } catch (error) {
      // The user got no answer, so don't charge them for the message
      await prisma.assistantConversation.updateMany({
        where: { id: conversationId, creditsUsed: { gt: 0 } },
        data: { creditsUsed: { decrement: 1 } },
      });
      throw error;
    }

    return json({
      response: result.text,
      finishReason: result.finishReason,
      conversationId,
      credits: spent.credits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Assistant API error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
