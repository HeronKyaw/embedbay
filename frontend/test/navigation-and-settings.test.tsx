import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "@/App";
import {
  createDefaultMockState,
  type MockBackendState,
  resetAppStores,
  setupTauriMocks,
} from "./mockTauri";

describe("Navigation, Onboarding, Command Palette & Settings", () => {
  let state: MockBackendState;

  beforeEach(() => {
    state = createDefaultMockState();
    setupTauriMocks(state);
    resetAppStores({ onboardingCompleted: true });
  });

  it("shows onboarding on first launch and completes into workspace", async () => {
    resetAppStores({ onboardingCompleted: false });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(/Welcome to EmbedBay/i)).toBeInTheDocument();

    // Step 0 -> 1 ("Get Started"), Steps 1..3 -> 4 ("Continue" x3)
    await user.click(screen.getByRole("button", { name: /Get Started/i }));
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /Continue/i }));
    }

    await user.click(screen.getByRole("button", { name: /Launch EmbedBay/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Primary Navigation")).toBeInTheDocument();
    });
  });

  it("navigates across Activity Rail sections (Explorer, Local Runtimes, Engine Store)", async () => {
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    expect(nav).toBeInTheDocument();

    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    expect(
      await screen.findByRole("button", { name: /New Instance/i }),
    ).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: /Engine Store/i }));
    expect(await screen.findByText("Qdrant")).toBeInTheDocument();
    expect(screen.getByText("Chroma")).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: /^Explorer/i }));
    expect(await screen.findByText("Local Qdrant Dev")).toBeInTheDocument();
  });

  it("opens Settings via Ctrl+, and exercises General, Embeddings, Storage, Diagnostics, and About tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Primary Navigation");

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });

    expect(
      await screen.findByRole("tablist", { name: "Settings Categories" }),
    ).toBeInTheDocument();

    // General tab: switch theme to Light
    await user.click(screen.getByRole("button", { name: /Light/i }));
    expect(document.documentElement.dataset.theme).toBe("light");

    // General tab: switch Close Behavior to Quit
    await user.click(
      screen.getByRole("button", { name: /Quit EmbedBay/i }),
    );
    await waitFor(() => {
      expect(
        state.calls.some(
          (c) => c.cmd === "set_close_behavior" && c.args.behavior === "quit",
        ),
      ).toBe(true);
    });

    // General tab: toggle Autostart
    await user.click(
      screen.getByRole("switch", { name: /Toggle Launch on OS Startup/i }),
    );
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "set_autostart_enabled")).toBe(
        true,
      );
    });

    // Embeddings tab
    await user.click(screen.getByRole("tab", { name: /Embeddings/i }));
    expect(await screen.findByText("Local Ollama Nomic")).toBeInTheDocument();

    // Storage tab + Compact DB
    await user.click(screen.getByRole("tab", { name: /Storage/i }));
    const compactBtn = await screen.findByRole("button", {
      name: /Compact Database/i,
    });
    await user.click(compactBtn);
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "compact_database")).toBe(true);
    });

    // Diagnostics tab
    await user.click(screen.getByRole("tab", { name: /Diagnostics/i }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "get_diagnostics")).toBe(true);
    });
    expect(
      await screen.findByText(/Windows Credential Manager/i),
    ).toBeInTheDocument();

    // About tab
    await user.click(screen.getByRole("tab", { name: /About/i }));
    expect(
      (await screen.findAllByText(/v0\.1\.0/i)).length,
    ).toBeGreaterThan(0);

    // Close settings
    await user.click(
      screen.getAllByRole("button", { name: "Close settings" })[0],
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("tablist", { name: "Settings Categories" }),
      ).not.toBeInTheDocument();
    });
  });

  it("opens Command Palette via Ctrl+K, navigates sections, and triggers Stop All", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Primary Navigation");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText(
      /Type a command, instance name, or tag/i,
    );
    expect(input).toBeInTheDocument();

    await user.type(input, "Stop All");
    await user.click(await screen.findByText("Stop All Running Services"));

    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "stop_all_instances")).toBe(
        true,
      );
    });
  });
});
