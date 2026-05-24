import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PlanMode } from "./plan-mode";

export default function (pi: ExtensionAPI): void {
  const planMode = new PlanMode(pi);
  planMode.register(pi);
}
