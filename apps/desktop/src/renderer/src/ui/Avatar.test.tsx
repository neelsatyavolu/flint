import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar initials by size", () => {
  it("keeps two initials at 24px and up", () => {
    render(<Avatar name="Carla Mendes" address="carla@brightfield.studio" size={24} />);
    expect(screen.getByRole("img", { name: "Carla Mendes" }).textContent).toBe("CM");
  });
  it("shows a single initial at 16px", () => {
    render(<Avatar name="Carla Mendes" address="carla@brightfield.studio" size={16} />);
    expect(screen.getByRole("img", { name: "Carla Mendes" }).textContent).toBe("C");
  });
});
