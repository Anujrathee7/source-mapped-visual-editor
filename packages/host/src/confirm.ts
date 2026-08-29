/**
 * The two things a stranger's repository is never allowed to do quietly (AC-11.5).
 *
 * `npm install` runs lifecycle scripts written by whoever owns the repository, and starting
 * the dev server loads that repository's `vite.config`, which is code as much as anything
 * under `src/`. Both are asked about, both prompts name the repository, and the default
 * answer is no — a host built without a way to ask is a host that cannot say yes.
 */
export type HostConfirmKind = 'install' | 'run';

export interface HostConfirmRequest {
  kind: HostConfirmKind;
  /** `owner/name`, as the clone was asked for. Named in the message, never elided. */
  repository: string;
  /** Where the code is, so the answer is about a place and not only about a name. */
  directory: string;
  /** Exactly what will be executed. */
  command: string;
  /** A whole sentence, safe to show verbatim. */
  message: string;
}

export type HostConfirm = (request: HostConfirmRequest) => boolean | Promise<boolean>;

export function confirmRequest(
  kind: HostConfirmKind,
  repository: string,
  directory: string,
  command: string,
): HostConfirmRequest {
  const message =
    kind === 'install'
      ? `Install dependencies for ${repository}? This runs \`${command}\` in ${directory}, ` +
        `which executes lifecycle scripts from ${repository} on this machine.`
      : `Start the dev server for ${repository}? This loads and runs that repository's ` +
        `Vite config from ${directory}.`;
  return { kind, repository, directory, command, message };
}

/** The default, and the only safe one: nobody asked, so the answer is no. */
export const denyByDefault: HostConfirm = () => false;

export async function ask(
  confirm: HostConfirm | undefined,
  request: HostConfirmRequest,
): Promise<boolean> {
  if (confirm === undefined) return false;
  return (await confirm(request)) === true;
}
