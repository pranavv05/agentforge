/**
 * Shown while a thread is being prepared.
 *
 * The page reads the database directly and is usually fast, so this is rarely on screen
 * for long — but when it is (a large spec, a cold start) the alternative is the previous
 * thread sitting there looking current while the address bar says otherwise, which is the
 * more confusing of the two. The shapes mirror the real layout so nothing jumps when the
 * content arrives.
 */
export default function Loading() {
  return (
    <main id="main" tabIndex={-1} className="stage" aria-busy="true">
      <div className="thread">
        <div className="thead">
          <div className="thead__main">
            <div className="skel skel--title" />
            <div className="skel skel--chips" />
          </div>
        </div>

        <div className="thread__scroll">
          <div className="thread__list" role="status">
            <span className="visually-hidden">Loading the conversation</span>
            <div className="skel skel--card" />
            <div className="skel skel--line" />
            <div className="skel skel--card" />
            <div className="skel skel--line skel--short" />
          </div>
        </div>
      </div>
    </main>
  );
}
