import supportsTerminalGraphics from "supports-terminal-graphics";

const graphicsSupport = supportsTerminalGraphics.stdout;

export const supportsKittyImages = graphicsSupport.kitty;
export const supportsItermImages = graphicsSupport.iterm2;
