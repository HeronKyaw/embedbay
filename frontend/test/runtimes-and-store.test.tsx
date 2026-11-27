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

describe("Engine Store & Local Runtimes", () => {
  let state: MockBackendState;

  beforeEach(() => {
    state = createDefaultMockState();
    setupTauriMocks(state);
    resetAppStores({ onboardingCompleted: true });
  });

  it("installs an uninstalled engine from Engine Store", async () => {
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(within(nav).getByRole("button", { name: /Engine Store/i }));
    expect(await screen.findByText("Chroma")).toBeInTheDocument();

    const installBtn = screen.getByRole("button", {
      name: /^Install$/i,
    });
    await user.click(installBtn);

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /Install v1\.4\.4/i }),
    );

    await waitFor(() => {
      expect(
        state.calls.some(
          (c) => c.cmd === "install_engine" && c.args.engineType === "chroma",
        ),
      ).toBe(true);
    });
  });

  it("persists download progress across page switches and supports Pause, Resume, and Stop", async () => {
    state.holdInstall = true;
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(within(nav).getByRole("button", { name: /Engine Store/i }));
    await user.click(
      await screen.findByRole("button", { name: /^Install$/i }),
    );
    const pickerDialog = await screen.findByRole("dialog");
    await user.click(
      within(pickerDialog).getByRole("button", { name: /Install v1\.4\.4/i }),
    );

    // StatusBar Download Tracker appears immediately
    const dlPill = await screen.findByRole("button", {
      name: "Active Engine Downloads",
    });
    expect(dlPill).toBeInTheDocument();

    // Switch to Explorer and Local Runtimes — download must NOT disappear
    await user.click(within(nav).getByRole("button", { name: /^Explorer/i }));
    expect(
      screen.getByRole("button", { name: "Active Engine Downloads" }),
    ).toBeInTheDocument();

    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    expect(
      screen.getByRole("button", { name: "Active Engine Downloads" }),
    ).toBeInTheDocument();

    // Open StatusBar Downloads popover, Pause then Resume
    await user.click(
      screen.getByRole("button", { name: "Active Engine Downloads" }),
    );
    const dlDialog = await screen.findByRole("dialog", {
      name: "Engine Downloads",
    });
    await user.click(within(dlDialog).getByRole("button", { name: /Pause/i }));
    await waitFor(() => {
      expect(
        state.calls.some(
          (c) =>
            c.cmd === "pause_engine_install" && c.args.engineType === "chroma",
        ),
      ).toBe(true);
    });

    await user.click(
      within(dlDialog).getByRole("button", { name: /Resume/i }),
    );
    await waitFor(() => {
      expect(
        state.calls.some(
          (c) =>
            c.cmd === "resume_engine_install" &&
            c.args.engineType === "chroma",
        ),
      ).toBe(true);
    });

    // Return to Engine Store — card still shows active download + Stop button
    await user.click(within(nav).getByRole("button", { name: /Engine Store/i }));
    const stopBtn = await screen.findByRole("button", { name: /^Stop$/i });
    await user.click(stopBtn);

    await waitFor(() => {
      expect(
        state.calls.some(
          (c) =>
            c.cmd === "cancel_engine_install" &&
            c.args.engineType === "chroma",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Active Engine Downloads" }),
      ).not.toBeInTheDocument();
    });
  });

  it("navigates from Create Instance -> Open Store to Engine Detail page and supports UI Back + Mouse Back", async () => {
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /New Instance/i }),
    );

    const modal = await screen.findByRole("dialog");
    const engineSelect = within(modal).getAllByRole("combobox")[0];
    await user.selectOptions(engineSelect, "chroma");

    // Click Open Store for uninstalled Chroma -> lands directly on Chroma product page
    await user.click(within(modal).getByRole("button", { name: /Open Store/i }));

    expect(
      await screen.findByRole("button", { name: /Back to Engine Store/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Available Releases")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chroma" })).toBeInTheDocument();

    // Mouse Back button (button === 3) returns to Engine Store catalog grid
    fireEvent.mouseDown(window, { button: 3 });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Back to Engine Store/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Native Engine Store")).toBeInTheDocument();

    // Click Qdrant card directly (no Details button) and return via UI Back button
    await user.click(screen.getByText("Qdrant"));
    const backBtn = await screen.findByRole("button", {
      name: /Back to Engine Store/i,
    });
    await user.click(backBtn);
    expect(await screen.findByText("Native Engine Store")).toBeInTheDocument();
  });

  it("refreshes engine catalog with feedback toast", async () => {
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(within(nav).getByRole("button", { name: /Engine Store/i }));

    await user.click(
      await screen.findByRole("button", { name: /Refresh Catalog/i }),
    );

    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "refresh_engine_catalog")).toBe(
        true,
      );
    });
    expect(await screen.findByText("Catalog refreshed")).toBeInTheDocument();
  });

  it("manages instance lifecycle, logs, and new instance creation in Local Runtimes", async () => {
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    expect(await screen.findByText("Local Qdrant Dev")).toBeInTheDocument();

    // Stop running instance
    await user.click(screen.getByRole("button", { name: /^Stop$/i }));
    await waitFor(() => {
      expect(
        state.calls.some(
          (c) => c.cmd === "stop_instance" && c.args.id === "inst-qdrant-1",
        ),
      ).toBe(true);
    });

    // Start stopped instance
    await user.click(await screen.findByRole("button", { name: /^Start$/i }));
    await waitFor(() => {
      expect(
        state.calls.some(
          (c) => c.cmd === "start_instance" && c.args.id === "inst-qdrant-1",
        ),
      ).toBe(true);
    });

    // View logs and clear logs
    await user.click(screen.getByTitle("View Logs"));
    expect(
      await screen.findByText(/Qdrant HTTP listening on 127\.0\.0\.1:6333/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Clear/i }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "clear_instance_logs")).toBe(
        true,
      );
    });

    // Open Create Instance Modal and create a new instance
    await user.click(screen.getByRole("button", { name: /New Instance/i }));
    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByPlaceholderText(
      "e.g. Local Qdrant Dev",
    );
    await user.clear(nameInput);
    await user.type(nameInput, "QA Qdrant Secondary");

    const createBtn = within(dialog).getByRole("button", {
      name: /Create Instance/i,
    });
    await user.click(createBtn);

    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "create_instance")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText("QA Qdrant Secondary")).toBeInTheDocument();
    });
  });
});
