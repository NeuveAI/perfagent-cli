import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { LocalAgent } from "./agent.js";

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

const stream = acp.ndJsonStream(input, output);
new acp.AgentSideConnection((conn) => new LocalAgent(conn), stream);
