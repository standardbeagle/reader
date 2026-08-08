import { useCallback, useEffect, useState } from "react";

export type ColumnName = "sidebar" | "list" | "reader";
export type ResizableColumn = Exclude<ColumnName, "reader">;

export interface ColumnLayoutState {
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
  listCollapsed: boolean;
  readerCollapsed: boolean;
}

const STORAGE_KEY = "reader-column-layout-v1";
const DEFAULTS: ColumnLayoutState = {
  sidebarWidth: 300,
  listWidth: 440,
  sidebarCollapsed: false,
  listCollapsed: false,
  readerCollapsed: false,
};

const limits: Record<ResizableColumn, { min: number; max: number }> = {
  sidebar: { min: 220, max: 520 },
  list: { min: 300, max: 720 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readLayout(): ColumnLayoutState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ColumnLayoutState> | null;
    if (!parsed) return DEFAULTS;
    return {
      sidebarWidth: clamp(Number(parsed.sidebarWidth) || DEFAULTS.sidebarWidth, limits.sidebar.min, limits.sidebar.max),
      listWidth: clamp(Number(parsed.listWidth) || DEFAULTS.listWidth, limits.list.min, limits.list.max),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      listCollapsed: parsed.listCollapsed === true,
      readerCollapsed: parsed.readerCollapsed === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useColumnLayout() {
  const [layout, setLayout] = useState<ColumnLayoutState>(readLayout);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const resize = useCallback((column: ResizableColumn, delta: number) => {
    setLayout((current) => {
      const key = column === "sidebar" ? "sidebarWidth" : "listWidth";
      const bound = limits[column];
      return { ...current, [key]: clamp(current[key] + delta, bound.min, bound.max) };
    });
  }, []);

  const toggle = useCallback((column: ColumnName) => {
    setLayout((current) => {
      const key = `${column}Collapsed` as "sidebarCollapsed" | "listCollapsed" | "readerCollapsed";
      return { ...current, [key]: !current[key] };
    });
  }, []);

  return { layout, resize, toggle };
}
