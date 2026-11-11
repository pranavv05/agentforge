import Link from 'next/link';
import type { ArtifactKind, SpecState } from '@agentforge/contract';
import { Markdown } from '@/components/ui/markdown';
import { DecideControls } from '@/components/workspace/decide-controls';

/**
 * The document pane.
 *
 * Where reading and deciding happen together, and the reason approval is not a button in
 * the chat. A reviewer approving sixteen requirements is binding their name to a content
 * hash permanently; the document, the hash and the controls therefore sit in one place,
 * and getting here requires opening the artifact.
 *
 * The decision controls appear only when the spec is at this artifact's gate and this is
 * the current version. An older version cannot be approved at all — the approval binds
 * to bytes, and those are not the current bytes.
 */

export interface PaneVersion {
  readonly version: number;
  readonly contentHash: string;
}

export function DocumentPane({
  specId,
  kind,
  contentMd,
  contentHash,
  version,
  versions,
  isHead,
  atGate,
  specVersion,
  specStatus,
}: {
  specId: string;
  kind: ArtifactKind;
  contentMd: string;
  contentHash: string;
  version: number;
  versions: readonly PaneVersion[];
  isHead: boolean;
  atGate: boolean;
  specVersion: number;
  specStatus: SpecState;
}) {
  const headVersion = versions[versions.length - 1]?.version ?? version;

  return (
    <aside className="pane" aria-label={`${kind} document`}>
      <header className="pane__head">
        <span className="pane__name mono">{kind}.md</span>

        {versions.length > 1 && (
          <nav className="pane__versions" aria-label="Versions">
            {versions.map((row) => (
              <Link
                className={`pane__ver${row.version === version ? ' is-on' : ''}`}
                key={row.version}
                href={`/workspace/${specId}?doc=${kind}&v=${String(row.version)}`}
                aria-current={row.version === version ? 'page' : undefined}
              >
                v{row.version}
              </Link>
            ))}
          </nav>
        )}

        <Link className="pane__close" href={`/workspace/${specId}`} aria-label="Close document">
          ✕
        </Link>
      </header>

      <div className="pane__hash">
        <span className="pane__hashLabel">content hash</span>
        <code>{contentHash}</code>
      </div>

      <div className="pane__doc">
        <Markdown source={contentMd} />
      </div>

      {atGate && isHead && (
        <DecideControls
          specId={specId}
          kind={kind}
          contentHash={contentHash}
          expectedVersion={specVersion}
        />
      )}

      {atGate && !isHead && (
        <div className="pane__note">
          Decisions bind to a content hash, so only the current version can be approved.{' '}
          <Link href={`/workspace/${specId}?doc=${kind}&v=${String(headVersion)}`}>
            Go to v{headVersion}
          </Link>
          .
        </div>
      )}

      {!atGate && (
        <div className="pane__note pane__note--quiet">
          Not at this gate — the spec is <code>{specStatus}</code>.
        </div>
      )}
    </aside>
  );
}
