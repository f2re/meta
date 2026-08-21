export const ADAPTERS = Object.freeze({
  docomator: Object.freeze({
    id: "docomator",
    adapter: "docomator-v1",
    displayName: "Оформлятор",
    currentPath: "/opt/docomator/current",
    versionFile: "VERSION",
    configFile: "/etc/docomator/docomator.env",
    portKey: "DOCOMATOR_PORT",
    defaultPort: 8080,
    requiredServices: ["docomator-api.service", "docomator-worker.service"],
    optionalServices: ["docomator-llm.service"],
    healthPath: "/readyz",
    native: Object.freeze({
      verify: Object.freeze({ script: "verify-bundle.sh", args: ["."] }),
      update: Object.freeze({ script: "update.sh", args: ["--bundle-root", "."] }),
      install: Object.freeze({ script: "install.sh", args: ["--bundle-root", ".", "--install-os-packages"] })
    })
  }),
  "planer-solving": Object.freeze({
    id: "planer-solving",
    adapter: "planer-solving-v1",
    displayName: "Борис по парам",
    currentPath: "/opt/planner-solving/current",
    versionFile: "VERSION",
    configFile: "/etc/default/planner-solving",
    portKey: "PLANNER_PORT",
    defaultPort: 8001,
    requiredServices: ["planner-solving.service"],
    optionalServices: [],
    healthPath: "/api/health",
    native: Object.freeze({
      verify: Object.freeze({ script: "verify_bundle.sh", args: ["--quiet", "."] }),
      update: Object.freeze({ script: "install_or_update.sh", args: ["--yes"] }),
      install: Object.freeze({ script: "install_or_update.sh", args: ["--yes"] })
    })
  }),
  "kafedra-planner": Object.freeze({
    id: "kafedra-planner",
    adapter: "kafedra-planner-v1",
    displayName: "Кафедра Planner",
    currentPath: "/opt/kafedra-planner/current",
    versionFile: "VERSION",
    configFile: "/etc/kafedra-planner/kafedra-planner.env",
    portKey: "KAFEDRA_PORT",
    defaultPort: 8080,
    requiredServices: ["kafedra-planner-api.service", "kafedra-planner-worker.service"],
    optionalServices: ["kafedra-planner-llama.service"],
    healthPath: "/api/system/health",
    native: Object.freeze({
      verify: null,
      update: Object.freeze({ script: "install.sh", args: [] }),
      install: Object.freeze({ script: "install.sh", args: [] })
    })
  })
});

export function adapterForProject(projectId) {
  const adapter = ADAPTERS[projectId];
  if (!adapter) throw new Error(`Неизвестный проект: ${projectId}`);
  return adapter;
}
