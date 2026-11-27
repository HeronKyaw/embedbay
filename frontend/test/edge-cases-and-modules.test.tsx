import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "@/App";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import {
  createDefaultMockState,
  type MockBackendState,
  resetAppStores,
  setupTauriMocks,
} from "./mockTauri";

describe("Full-Module & Adversarial End-User Edge Cases", () => {
  let state: MockBackendState;

  beforeEach(() => {
    state = createDefaultMockState();
    setupTauriMocks(state);
    resetAppStores({ onboardingCompleted: true });
  });

  it("cleans up zombie Explorer tabs and selectedConnectionKey when deleting a local instance", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Open collection tab on Local Qdrant Dev
    await user.click(await screen.findByText("Local Qdrant Dev"));
    await user.click(await screen.findByText("docs_chunks"));
    expect(useTabsStore.getState().tabs.length).toBeGreaterThan(0);

    // Switch to Local Runtimes and delete Local Qdrant Dev
    const nav = screen.getByLabelText("Primary Navigation");
    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    await user.click(screen.getByTitle("Delete Instance"));

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /Delete Instance/i }),
    );

    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "delete_instance")).toBe(true);
    });
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useRuntimeStore.getState().selectedConnectionKey).toBeNull();
  });

  it("recognizes sqlite_vec as an embedded zero-daemon engine across ServicesDashboard and CommandPalette", async () => {
    state.instances.push({
      id: "inst-sqlite-1",
      name: "Embedded SQLite Vec",
      description: null,
      color: "#14B8A6",
      group_id: null,
      engine_type: "sqlite_vec",
      engine_version: "embedded-1.0",
      host: "127.0.0.1",
      port: 0,
      grpc_port: null,
      data_dir: "C:\\Users\\qa\\sqlite_vec",
      config_json: "{}",
      auto_start: false,
      idle_timeout_minutes: 0,
      sort_order: 1,
      created_at: Math.floor(Date.now() / 1000),
      tag_ids: [],
    });
    state.metrics["inst-sqlite-1"] = {
      instance_id: "inst-sqlite-1",
      status: "stopped",
      pid: null,
      ram_bytes: 0,
      cpu_percent: 0,
      uptime_secs: 0,
      disk_bytes: 0,
      restart_count: 0,
      last_error: null,
      last_activity_at: Math.floor(Date.now() / 1000),
    };

    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    expect(await screen.findByText("Embedded SQLite Vec")).toBeInTheDocument();

    // Embedded engine should have Explore button directly without Start/Stop
    const exploreButtons = screen.getAllByRole("button", { name: /Explore/i });
    expect(exploreButtons.length).toBeGreaterThanOrEqual(2);

    // Command Palette should NOT list Start/Stop for embedded sqlite_vec
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      screen.queryByText(/Start Embedded SQLite Vec/i),
    ).not.toBeInTheDocument();
  });

  it("exercises ExplorerHome Groups, Tags, Status Chips, and Search Filter", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local Qdrant Dev")).toBeInTheDocument();

    // Status filter chips: Remote hides local instance, All restores it
    await user.click(screen.getByRole("button", { name: "Remote" }));
    expect(screen.queryByText("Local Qdrant Dev")).not.toBeInTheDocument();
    expect(screen.getByText("Prod Pinecone RO")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Local Qdrant Dev")).toBeInTheDocument();

    // Open GroupModal and create a group
    await user.click(screen.getByRole("button", { name: /New Group/i }));
    const grpDialog = await screen.findByRole("dialog");
    const grpInput = within(grpDialog).getByPlaceholderText(/e\.g\./i);
    await user.type(grpInput, "Staging");
    await user.click(
      within(grpDialog).getByRole("button", { name: /Create Group/i }),
    );
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "create_group")).toBe(true);
    });

    // Open TagManagerModal and create a tag
    await user.click(screen.getByRole("button", { name: "Manage Tags" }));
    const tagDialog = await screen.findByRole("dialog");
    const tagInput = within(tagDialog).getByPlaceholderText(/e\.g\.|tag/i);
    await user.type(tagInput, "staging");
    await user.click(
      within(tagDialog).getByRole("button", { name: "Add" }),
    );
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "create_tag")).toBe(true);
    });
  });

  it("blocks duplicate instance names and invalid Config JSON in CreateInstanceModal", async () => {
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByLabelText("Primary Navigation");
    await user.click(
      within(nav).getByRole("button", { name: /Local Runtimes/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /New Instance/i }),
    );

    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByPlaceholderText(
      "e.g. Local Qdrant Dev",
    );

    // Duplicate name
    await user.clear(nameInput);
    await user.type(nameInput, "Local Qdrant Dev");
    expect(
      await screen.findByText(/An instance with this name already exists\./i),
    ).toBeInTheDocument();

    const createBtn = within(dialog).getByRole("button", {
      name: /Create Instance/i,
    });
    await user.click(createBtn);
    expect(
      await screen.findByText(/Instance name already exists/i),
    ).toBeInTheDocument();
    expect(state.calls.some((c) => c.cmd === "create_instance")).toBe(false);

    // Valid name + invalid Config JSON
    await user.clear(nameInput);
    await user.type(nameInput, "Unique Qdrant");
    const configTextarea = dialog.querySelector("textarea");
    expect(configTextarea).not.toBeNull();
    fireEvent.change(configTextarea!, { target: { value: "{bad-json" } });
    await user.click(createBtn);

    expect(await screen.findByText(/Invalid config JSON/i)).toBeInTheDocument();
    expect(state.calls.some((c) => c.cmd === "create_instance")).toBe(false);
  });

  it("validates FilterBuilder Raw JSON and IndexManagerModal empty/valid submissions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Local Qdrant Dev"));
    await user.click(await screen.findByText("docs_chunks"));
    await waitFor(() => {
      expect(screen.getByText("rec-1")).toBeInTheDocument();
    });

    // Open FilterBuilder, switch to Raw JSON, enter invalid JSON -> Apply disabled
    await user.click(screen.getByRole("button", { name: /Raw JSON/i }));
    const rawArea = screen.getByPlaceholderText(/must|status|{|"key"/i);
    fireEvent.change(rawArea, { target: { value: "{bad" } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    // Open IndexManagerModal: empty field disables Create Index; valid field creates index
    await user.click(screen.getByRole("button", { name: /Indexes/i }));
    const idxDialog = await screen.findByRole("dialog");
    expect(
      within(idxDialog).getByRole("button", { name: /Create Index/i }),
    ).toBeDisabled();

    const fieldInput = within(idxDialog).getByPlaceholderText(/e\.g\./i);
    await user.type(fieldInput, "author");
    await user.click(
      within(idxDialog).getByRole("button", { name: /Create Index/i }),
    );
    await waitFor(() => {
      expect(
        state.calls.some((c) => c.cmd === "create_collection_index"),
      ).toBe(true);
    });
  });

  it("tests Search Playground Presets, History, and Compare Mode, plus StatusBar & Command Palette actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    // StatusBar Telemetry popover
    await user.click(
      await screen.findByRole("button", {
        name: "System and Database Resource Telemetry",
      }),
    );
    const telemetryDialog = await screen.findByRole("dialog", {
      name: "Resource Usage Details",
    });
    expect(
      within(telemetryDialog).getByText("Local Qdrant Dev"),
    ).toBeInTheDocument();
    await user.click(
      within(telemetryDialog).getByRole("button", { name: /Stop All/i }),
    );
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "stop_all_instances")).toBe(
        true,
      );
    });

    // Close StatusBar popover, then open collection -> Search Playground -> Compare toggle
    fireEvent.keyDown(window, { key: "Escape" });
    await user.click(screen.getByText("Local Qdrant Dev"));
    await user.click(await screen.findByText("docs_chunks"));
    await user.click(
      await screen.findByRole("button", { name: /Search Playground/i }),
    );

    const queryBox = await screen.findByPlaceholderText(
      /Ask a question|Enter.*query|Search query/i,
    );
    await user.type(queryBox, "vector database");
    await user.click(screen.getByRole("button", { name: /Run Search/i }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "search_vectors")).toBe(true);
    });

    // Toggle Compare A/B mode
    await user.click(screen.getByRole("button", { name: /Compare A\/B/i }));
    expect(
      await screen.findByRole("button", { name: /Exit Compare/i }),
    ).toBeInTheDocument();

    // Command Palette: Theme Light + Settings Diagnostics
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const paletteInput = await screen.findByPlaceholderText(
      /Type a command, instance name, or tag/i,
    );
    await user.type(paletteInput, "light");
    await user.click(await screen.findByText("Theme: Light"));
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const paletteInput2 = await screen.findByPlaceholderText(
      /Type a command, instance name, or tag/i,
    );
    await user.type(paletteInput2, "Diagnostics");
    await user.click(await screen.findByText("Settings: Diagnostics"));
    expect(
      await screen.findByText(/Windows Credential Manager/i),
    ).toBeInTheDocument();
  });
});
