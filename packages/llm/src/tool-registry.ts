import type {
  AimcubToolContract,
  AimcubToolFailure,
  AimcubToolHandler,
  AimcubToolHandlerContext,
  AimcubToolName,
  AimcubToolResult,
  ContextAskUserInput,
  ContextAskUserOutput,
  ContextDistillInput,
  ContextDistillOutput,
  LocalEditInput,
  LocalEditOutput,
  LocalGlobInput,
  LocalGlobOutput,
  LocalReadInput,
  LocalReadOutput,
  LocalScanWorkspaceInput,
  LocalScanWorkspaceOutput,
  LocalSearchInput,
  LocalSearchOutput,
  LocalWriteInput,
  LocalWriteOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryWriteCandidateInput,
  MemoryWriteCandidateOutput,
  WebFetchInput,
  WebFetchOutput,
  WebSearchInput,
  WebSearchOutput,
} from "./tool-contract";
import { BUILT_IN_TOOL_CONTRACTS, getBuiltInToolContract } from "./tool-contract";

export interface AimcubToolInputByName {
  "local.read": LocalReadInput;
  "local.write": LocalWriteInput;
  "local.edit": LocalEditInput;
  "local.search": LocalSearchInput;
  "local.glob": LocalGlobInput;
  "local.scan_workspace": LocalScanWorkspaceInput;
  "memory.search": MemorySearchInput;
  "memory.write_candidate": MemoryWriteCandidateInput;
  "web.search": WebSearchInput;
  "web.fetch": WebFetchInput;
  "context.distill": ContextDistillInput;
  "context.ask_user": ContextAskUserInput;
}

export interface AimcubToolOutputByName {
  "local.read": LocalReadOutput;
  "local.write": LocalWriteOutput;
  "local.edit": LocalEditOutput;
  "local.search": LocalSearchOutput;
  "local.glob": LocalGlobOutput;
  "local.scan_workspace": LocalScanWorkspaceOutput;
  "memory.search": MemorySearchOutput;
  "memory.write_candidate": MemoryWriteCandidateOutput;
  "web.search": WebSearchOutput;
  "web.fetch": WebFetchOutput;
  "context.distill": ContextDistillOutput;
  "context.ask_user": ContextAskUserOutput;
}

export type AimcubTypedToolHandler<Name extends AimcubToolName> = AimcubToolHandler<
  AimcubToolInputByName[Name],
  AimcubToolOutputByName[Name]
>;

export type AimcubToolHandlerMap = {
  [Name in AimcubToolName]?: AimcubTypedToolHandler<Name>;
};

export interface AimcubToolRegistry {
  readonly contracts: readonly AimcubToolContract[];
  has<Name extends AimcubToolName>(name: Name): boolean;
  getContract<Name extends AimcubToolName>(name: Name): AimcubToolContract<Name>;
  listAvailable(): AimcubToolContract[];
  execute<Name extends AimcubToolName>(
    name: Name,
    input: AimcubToolInputByName[Name],
    context: AimcubToolHandlerContext,
  ): Promise<AimcubToolResult<AimcubToolOutputByName[Name]>>;
}

function disabled<Name extends AimcubToolName>(name: Name): AimcubToolResult<AimcubToolOutputByName[Name]> {
  return {
    ok: false,
    error: {
      code: "disabled",
      message: `${name} is not registered in the current Aimcub runtime.`,
      retryable: false,
    },
  };
}

function unknownError<Name extends AimcubToolName>(
  name: Name,
  err: unknown,
): AimcubToolResult<AimcubToolOutputByName[Name]> {
  const message = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    error: {
      code: "unknown_error",
      message: `${name} failed unexpectedly: ${message}`,
      retryable: true,
      details: { tool: name },
    } satisfies AimcubToolFailure,
  };
}

export function createAimcubToolRegistry(
  handlers: AimcubToolHandlerMap,
  contracts: readonly AimcubToolContract[] = BUILT_IN_TOOL_CONTRACTS,
): AimcubToolRegistry {
  const registered = new Map<AimcubToolName, AimcubTypedToolHandler<AimcubToolName>>();
  for (const [name, handler] of Object.entries(handlers) as Array<[AimcubToolName, AimcubTypedToolHandler<AimcubToolName> | undefined]>) {
    if (handler) registered.set(name, handler);
  }

  return {
    contracts,
    has<Name extends AimcubToolName>(name: Name): boolean {
      return registered.has(name);
    },
    getContract<Name extends AimcubToolName>(name: Name): AimcubToolContract<Name> {
      return getBuiltInToolContract(name);
    },
    listAvailable(): AimcubToolContract[] {
      return contracts.filter((contract) => registered.has(contract.name));
    },
    async execute<Name extends AimcubToolName>(
      name: Name,
      input: AimcubToolInputByName[Name],
      context: AimcubToolHandlerContext,
    ): Promise<AimcubToolResult<AimcubToolOutputByName[Name]>> {
      const handler = registered.get(name) as AimcubTypedToolHandler<Name> | undefined;
      if (!handler) return disabled(name);
      try {
        return await handler(input, context);
      } catch (err) {
        return unknownError(name, err);
      }
    },
  };
}
