import { getServerSession } from "next-auth";
import prisma from "../../lib/prisma";
import { authOptions } from "../../lib/auth";
import { Groq } from "groq-sdk";

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
            name: true,
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
          name: g.name,
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

        const task = await prisma.planningTask.findUnique({
          where: { id: taskId },
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

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { messages } = await request.json();

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

    let response = await groq.chat.completions.create({
      model: "llama-3.1-70b-versatile",
      messages: messages as any,
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

      // Build conversation to continue
      const newMessages = [
        ...messages,
        {
          role: "assistant" as const,
          content: response.choices[0].message.content,
          tool_calls: toolCalls,
        },
      ];

      // Add tool results
      toolResults.forEach((tr) => {
        newMessages.push({
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: tr.tool_call_id,
              content: JSON.stringify(tr.result),
            },
          ],
        });
      });

      // Continue conversation
      response = await groq.chat.completions.create({
        model: "llama-3.1-70b-versatile",
        messages: newMessages,
        tools: tools as unknown as Groq.Chat.ChatCompletionTool[],
        tool_choice: "auto",
        max_tokens: 1024,
      });
    }

    const finalText = response.choices[0]?.message.content || "";

    return new Response(
      JSON.stringify({
        response: finalText,
        finishReason: response.choices[0]?.finish_reason,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Assistant API error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
