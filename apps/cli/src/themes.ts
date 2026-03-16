export interface ThemeDefinition {
  name: string;
  variant: "light" | "dark";
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  text: string;
  textMuted: string;
  border: string;
  borderActive: string;
  borderSubtle: string;
}

export const DEFAULT_DARK_THEME_NAME = "mono";

export const THEMES: Record<string, ThemeDefinition> = {
  mono: {
    name: "Mono",
    variant: "dark",
    primary: "#FFFFFF",
    secondary: "#B0B0B0",
    accent: "#D0D0D0",
    error: "#B0B0B0",
    warning: "#B0B0B0",
    success: "#B0B0B0",
    info: "#909090",
    text: "#E0E0E0",
    textMuted: "#707070",
    border: "#505050",
    borderActive: "#909090",
    borderSubtle: "#303030",
  },
  "flexoki-light": {
    name: "Flexoki Light",
    variant: "light",
    primary: "#205EA6",
    secondary: "#5E409D",
    accent: "#BC5215",
    error: "#AF3029",
    warning: "#BC5215",
    success: "#66800B",
    info: "#24837B",
    text: "#100F0F",
    textMuted: "#6F6E69",
    border: "#B7B5AC",
    borderActive: "#878580",
    borderSubtle: "#CECDC3",
  },
};
