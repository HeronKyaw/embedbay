import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "@/App";
import {
  createDefaultMockState,
  type MockBackendState,
  resetAppStores,
  setupTauriMocks,
} from "./mockTauri";

describe("Vector Explorer, Read-Only Guard, Search Playground & Visualizer", () => {
  let state: MockBackendState;

  beforeEach(() => {
    state = createDefaultMockState();
    setupTauriMocks(state);
    resetAppStores({ onboardingCompleted: true });
  });

  it("opens local collection, exercises Search Playground edge cases, presets, and Visualizer 2D/3D + PCA/UMAP", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Explorer Home shows local instance & remote connection
    expect(await screen.findByText("Local Qdrant Dev")).toBeInTheDocument();
    expect(screen.getByText("Prod Pinecone RO")).toBeInTheDocument();

    // Click Local Qdrant Dev to list collections
    await user.click(screen.getByText("Local Qdrant Dev"));
    const colBtn = await screen.findByText("docs_chunks");
    await user.click(colBtn);

    // CollectionHeader & RecordTable load
    await waitFor(() => {
      expect(screen.getByText("rec-1")).toBeInTheDocument();
      expect(screen.getByText("rec-2")).toBeInTheDocument();
    });

    // Open Search Playground tab
    await user.click(screen.getByRole("button", { name: /Search Playground/i }));

    // Edge case 1: empty query shows validation toast and does not call search_vectors
    await user.click(
      await screen.findByRole("button", { name: /Run Search/i }),
    );
    expect(
      await screen.findByText(/Enter a search query string/i),
    ).toBeInTheDocument();
    expect(state.calls.some((c) => c.cmd === "search_vectors")).toBe(false);

    // Run valid text semantic search
    const queryBox = await screen.findByPlaceholderText(
      /Ask a question|Enter.*query|Search query/i,
    );
    await user.type(queryBox, "architecture separation");
    await user.click(screen.getByRole("button", { name: /Run Search/i }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "search_vectors")).toBe(true);
      expect(state.calls.some((c) => c.cmd === "record_search_history")).toBe(
        true,
      );
    });

    // Edge case 2: Switch to Raw Vector mode and enter invalid JSON
    await user.click(screen.getByRole("button", { name: "Raw Vector" }));
    const vecBox = await screen.findByPlaceholderText(/\[0\.021/i);
    await user.type(vecBox, "not-a-vector");
    await user.click(screen.getByRole("button", { name: /Run Search/i }));
    expect(await screen.findByText(/Search failed/i)).toBeInTheDocument();

    // Switch back to collection tab and open Visualizer (PCA/UMAP + 2D/3D)
    const docMatches = screen.getAllByText(/docs_chunks/);
    await user.click(docMatches[0]);
    await user.click(
      await screen.findByRole("button", { name: /Visualize 2D\/3D/i }),
    );
    await waitFor(() => {
      expect(
        state.calls.some((c) => c.cmd === "compute_embedding_projection"),
      ).toBe(true);
    });

    // Switch to UMAP & 3D
    await user.click(await screen.findByRole("button", { name: /^UMAP$/i }));
    await user.click(await screen.findByRole("button", { name: /^3D$/i }));
    await waitFor(() => {
      expect(
        state.calls.some(
          (c) =>
            c.cmd === "compute_embedding_projection" &&
            c.args.method === "umap" &&
            c.args.dims === 3,
        ),
      ).toBe(true);
    });
  });

  it("opens collection modals (Upsert Record, Indexes, Import / Export, Migrate)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Local Qdrant Dev"));
    await user.click(await screen.findByText("docs_chunks"));
    await waitFor(() => {
      expect(screen.getByText("rec-1")).toBeInTheDocument();
    });

    // Upsert modal
    await user.click(screen.getByRole("button", { name: /Upsert Record/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    // Indexes modal (Qdrant)
    await user.click(screen.getByRole("button", { name: /Indexes/i }));
    await waitFor(() => {
      expect(
        state.calls.some((c) => c.cmd === "list_collection_indexes"),
      ).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: /Close modal/i }));

    // Import / Export modal
    await user.click(screen.getByRole("button", { name: /Import \/ Export/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Close modal/i }));

    // Migrate modal
    await user.click(screen.getByRole("button", { name: /^Migrate$/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Close modal/i }));
  });

  it("enforces Read-Only badge and disables destructive write buttons on read-only remote connections", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Prod Pinecone RO"));
    const colBtn = await screen.findByText("prod_kb");
    await user.click(colBtn);

    await waitFor(() => {
      expect(screen.getByText("prod-1")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Read-Only").length).toBeGreaterThan(0);
    const disabledButtons = screen.getAllByTitle("Disabled in Read-Only mode");
    expect(disabledButtons.length).toBeGreaterThanOrEqual(3);
    for (const btn of disabledButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it("opens Remote Connection modal, tests connection, and saves a new remote connection", async () => {
    const user = userEvent.setup();
    render(<App />);

    const addBtn = await screen.findByRole("button", {
      name: /Add Connection/i,
    });
    await user.click(addBtn);

    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByPlaceholderText(
      "e.g. Prod Pinecone US-East",
    );
    await user.type(nameInput, "Staging Weaviate");

    const urlInput = within(dialog).getByPlaceholderText(/https:\/\//i);
    await user.type(urlInput, "https://staging.weaviate.network");

    await user.click(
      within(dialog).getByRole("button", { name: /Test Connection/i }),
    );
    await waitFor(() => {
      expect(state.calls.some((c) => c.cmd === "test_connection")).toBe(true);
    });

    await user.click(
      within(dialog).getByRole("button", { name: /Add Connection/i }),
    );

    await waitFor(() => {
      expect(
        state.calls.some((c) => c.cmd === "create_remote_connection"),
      ).toBe(true);
    });
  });
});
