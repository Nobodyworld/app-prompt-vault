import {
  configureLoopbackOnlyEnvironment,
  installLoopbackOnlyListenGuard,
} from "./config/networkSecurity.js";

const network = configureLoopbackOnlyEnvironment();
installLoopbackOnlyListenGuard(network.host);

await import("./server-internal.js");
