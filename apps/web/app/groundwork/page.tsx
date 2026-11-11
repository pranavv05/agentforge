export const metadata = {
  title: 'Groundwork - Evidence-first specs',
  description: 'Turn repository context into reviewable, grounded engineering work.',
};

export default function GroundworkPage() {
  return (
    <div
      style={{
        height: 'calc(100vh - 54px)',
        maxWidth: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      <iframe
        src="/groundwork.html"
        title="Groundwork evidence-first workflow"
        style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
