import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RuleEditor } from "./RuleEditor";
import { newRule } from "./ruleValidation";

describe("RuleEditor", () => {
  it("blocks saving an empty rule and shows why", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RuleEditor initial={newRule(0)} accounts={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(screen.getByText("Name the rule.")).toBeTruthy();
    expect(screen.getByText("Enter a value.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects an invalid pattern, then saves a valid rule", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RuleEditor initial={newRule(0)} accounts={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "Receipts" } });
    fireEvent.change(screen.getByLabelText("Condition 1 test"), { target: { value: "matches" } });
    fireEvent.change(screen.getByLabelText("Condition 1 value"), { target: { value: "(" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(screen.getByText("That pattern isn't valid.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Condition 1 value"), { target: { value: "receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ name: "Receipts", conditions: [{ field: "from", op: "matches", value: "receipt" }] });
  });

  it("requires a folder for a move action and hides the value for has attachment", () => {
    render(<RuleEditor initial={{ ...newRule(0), name: "x" }} accounts={[]} onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Condition 1 field"), { target: { value: "has_attachment" } });
    expect(screen.queryByLabelText("Condition 1 value")).toBeNull();
    fireEvent.change(screen.getByLabelText("Action 1"), { target: { value: "move" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(screen.getByText("Enter a folder.")).toBeTruthy();
  });
});
