import { createInterface } from 'node:readline';

export type SetupIO = { write(text: string): void; readLine(): Promise<string | null>; close?(): void };
export class SetupCancelled extends Error {}
export class SetupBack extends Error {}

export function createTerminalIO(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): SetupIO {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const interrupt = () => { lines.close(); };
  process.once('SIGINT', interrupt);
  return {
    write: text => { output.write(text); },
    async readLine() { const next = await iterator.next(); return next.done ? null : next.value; },
    close() { process.removeListener('SIGINT', interrupt); lines.close(); },
  };
}

export const EXAMPLES = {
  organization: 'Example organization URL: https://dev.azure.com/contoso\n  contoso = organization\nEnter its name or full organization URL.',
  project: 'Example project URL: https://dev.azure.com/contoso/Commerce\n  contoso = organization\n  Commerce = project\nPaste the full URL or org/project. A name alone also works when one organization is configured.',
  repository: 'Example repository URL: https://dev.azure.com/contoso/Commerce/_git/Payments\n  contoso = organization\n  Commerce = project\n  _git = repository route, not a name to enter\n  Payments = repository\nPaste the full repository URL, or enter its existing local checkout folder.',
  checkout: 'Where is the source code already checked out?\nExample: C:\\src\\Payments\nEnter an existing checkout folder, not a URL or the parent C:\\src folder.\nSpaces and commas are literal. ASDF does not clone repositories.',
  backlog: 'Example backlog URL:\nhttps://dev.azure.com/contoso/Commerce/_backlogs/backlog/Data%20Movement/Features?showParents=false\n  contoso = organization\n  Commerce = project\n  Data%20Movement = team "Data Movement" (%20 is a space)\n  Features = browser view, not an ASDF type filter\n  showParents=false = display only\nPaste the full browser URL for the team backlog, or a project URL/org/project to watch a project.',
};
