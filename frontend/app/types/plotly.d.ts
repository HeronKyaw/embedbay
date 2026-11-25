declare module "plotly.js-dist-min" {
  export interface PlotlyHTMLElement extends HTMLDivElement {
    on(eventName: string, handler: (data: PlotlyClickEvent) => void): void;
    removeAllListeners?(eventName: string): void;
  }

  export interface PlotlyClickPoint {
    pointNumber?: number;
    pointIndex?: number;
    customdata?: unknown;
  }

  export interface PlotlyClickEvent {
    points: PlotlyClickPoint[];
  }

  const Plotly: {
    react(
      root: HTMLElement,
      data: Record<string, unknown>[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<PlotlyHTMLElement>;
    purge(root: HTMLElement): void;
  };

  export default Plotly;
}
