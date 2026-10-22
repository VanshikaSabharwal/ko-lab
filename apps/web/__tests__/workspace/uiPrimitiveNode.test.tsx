import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import UiPrimitiveNode, {
  type UiKind,
} from "../../app/workspace/[groupId]/ui-design/UiPrimitiveNode";

/**
 * Text on the design board is edited by double-clicking the element. It used
 * to need a double-click on the text itself, so elements with no text yet (an
 * unnamed toggle or checkbox) had nothing to click and couldn't be edited.
 */
function renderNode(kind: UiKind, label = "") {
  const onChange = vi.fn();
  const props = {
    id: "n1",
    data: { kind, label, onChange },
    selected: false,
  } as unknown as NodeProps;
  const { container } = render(
    <ReactFlowProvider>
      <UiPrimitiveNode {...props} />
    </ReactFlowProvider>,
  );
  const element = container.querySelector("[title='Double-click to edit text']") as HTMLElement | null;
  return { onChange, element };
}

function editTo(element: HTMLElement, text: string) {
  fireEvent.doubleClick(element);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("UiPrimitiveNode text editing", () => {
  it.each<UiKind>(["button", "badge", "text", "input", "dropdown"])(
    "edits a %s's text",
    (kind) => {
      const { onChange, element } = renderNode(kind);
      editTo(element!, "Hello");
      expect(onChange).toHaveBeenCalledWith("Hello");
    },
  );

  it.each<UiKind>(["toggle", "checkbox", "navbar"])(
    "edits an unnamed %s (no text to click on)",
    (kind) => {
      const { onChange, element } = renderNode(kind);
      expect(element).not.toBeNull();
      editTo(element!, "Dark mode");
      expect(onChange).toHaveBeenCalledWith("Dark mode");
    },
  );

  it.each<UiKind>(["frame", "card", "container", "image", "avatar"])(
    "edits a %s from anywhere on it",
    (kind) => {
      const { onChange, element } = renderNode(kind);
      editTo(element!, "Profile");
      expect(onChange).toHaveBeenCalledWith("Profile");
    },
  );

  it("edits tabs as a comma-separated list", () => {
    const { onChange, element } = renderNode("tabs");
    editTo(element!, "Home, Settings");
    expect(onChange).toHaveBeenCalledWith("Home, Settings");
  });

  it("starts from the current text", () => {
    const { element } = renderNode("button", "Sign up");
    fireEvent.doubleClick(element!);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Sign up");
  });

  it("Escape cancels without saving", () => {
    const { onChange, element } = renderNode("button", "Sign up");
    fireEvent.doubleClick(element!);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Sign up")).toBeTruthy();
  });

  it("clicking away saves", () => {
    const { onChange, element } = renderNode("text");
    fireEvent.doubleClick(element!);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Welcome" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("Welcome");
  });

  it.each<UiKind>(["divider", "table", "chart"])("leaves a %s alone (it has no text)", (kind) => {
    const { element } = renderNode(kind);
    expect(element).toBeNull();
  });
});

describe("UiPrimitiveNode image upload", () => {
  function renderImage(data: Record<string, unknown> = {}) {
    const onPickImage = vi.fn();
    const props = {
      id: "img",
      data: { kind: "image", label: "", onChange: vi.fn(), onPickImage, ...data },
      selected: false,
    } as unknown as NodeProps;
    const { container } = render(
      <ReactFlowProvider>
        <UiPrimitiveNode {...props} />
      </ReactFlowProvider>,
    );
    return { onPickImage, root: container.firstElementChild as HTMLElement };
  }

  it("double-click opens the file picker instead of a text box", () => {
    const { onPickImage, root } = renderImage();
    expect(root.title).toBe("Double-click to upload an image");
    fireEvent.doubleClick(root);
    expect(onPickImage).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the uploaded picture, with the caption as alt text", () => {
    const { root } = renderImage({ src: "https://cdn.example/a.png", label: "Hero banner" });
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example/a.png");
    expect(img.alt).toBe("Hero banner");
    expect(root.title).toBe("Double-click to replace the image");
  });

  it("shows progress while uploading", () => {
    renderImage({ uploading: true });
    expect(screen.getByText("Uploading…")).toBeTruthy();
  });

  it("keeps the placeholder until a picture is uploaded", () => {
    renderImage();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Image")).toBeTruthy();
  });
});
