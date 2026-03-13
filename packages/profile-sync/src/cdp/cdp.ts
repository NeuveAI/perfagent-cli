import WebSocket from "ws";
import { CDP_RETRY_COUNT, CDP_RETRY_DELAY_MS } from "../constants.js";
import type { CdpRawCookie, CdpResponse } from "../types.js";

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const getWebSocketDebuggerUrl = async (port: number): Promise<string> => {
  const versionUrl = `http://localhost:${port}/json/version`;

  for (let attempt = 0; attempt < CDP_RETRY_COUNT; attempt++) {
    try {
      const response = await fetch(versionUrl);
      const data = (await response.json()) as Record<string, unknown>;
      const webSocketDebuggerUrl = data["webSocketDebuggerUrl"];
      if (typeof webSocketDebuggerUrl === "string" && webSocketDebuggerUrl.length > 0) {
        return webSocketDebuggerUrl;
      }
      throw new Error("no webSocketDebuggerUrl found in CDP response");
    } catch (error) {
      if (attempt === CDP_RETRY_COUNT - 1) {
        throw new Error(
          `failed to fetch CDP version after ${CDP_RETRY_COUNT} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await sleep(CDP_RETRY_DELAY_MS);
    }
  }

  throw new Error("unreachable");
};

const sendCdpCommand = (
  webSocketUrl: string,
  command: Record<string, unknown>,
): Promise<CdpResponse> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);

    socket.on("open", () => {
      socket.send(JSON.stringify(command));
    });

    socket.on("message", (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString()) as CdpResponse;
        socket.close();
        resolve(response);
      } catch (error) {
        socket.close();
        reject(
          new Error(
            `failed to parse CDP response: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });

    socket.on("error", (error: Error) => {
      reject(new Error(`CDP WebSocket error: ${error.message}`));
    });
  });

export const getCookiesFromBrowser = async (webSocketUrl: string): Promise<CdpRawCookie[]> => {
  for (let attempt = 0; attempt < CDP_RETRY_COUNT; attempt++) {
    try {
      const response = await sendCdpCommand(webSocketUrl, {
        id: 1,
        method: "Storage.getCookies",
      });

      if (response.error) {
        throw new Error(`CDP error: ${response.error.message} (code ${response.error.code})`);
      }

      return response.result?.cookies ?? [];
    } catch (error) {
      if (attempt === CDP_RETRY_COUNT - 1) {
        throw new Error(
          `failed to get cookies after ${CDP_RETRY_COUNT} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await sleep(CDP_RETRY_DELAY_MS);
    }
  }

  return [];
};
