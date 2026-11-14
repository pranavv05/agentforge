import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { Modes } from './components/Modes'
import { Grounding } from './components/Grounding'
import { Lint } from './components/Lint'
import { KeyVault } from './components/KeyVault'
import { MotionInit } from './components/MotionInit'
import { Split } from './components/Split'
import { Band, Cta, Compare, Faq, Features, Manifesto, Numbers, Pipeline, SectionHead, Stats } from './components/Pieces'

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Manifesto />

        {/* THREE MODES */}
        <section className="s" id="modes"><div className="wrap">
          <SectionHead eyebrow="One platform. Three guarantees." lines={[['Specs you can audit,'], ['not just read.']]} sub="Pick a guarantee to see it in action. Each one is a feature of the product, not a slide." />
          <Modes />
        </div></section>

        <Band />
        <Pipeline />
        <Numbers />

        {/* GROUNDING */}
        <section className="s" id="grounding"><div className="wrap">
          <SectionHead eyebrow="Grounding verifier" lines={[['Try to fool it.']]}
            sub="Five claims an agent might make about a sample ERP repo. Some are true, some are invented. Run the verifier on each. The check is plain code, no model involved, and a catch is the product doing its job." />
          <Grounding />
        </div></section>

        <Features />

        {/* BRING YOUR OWN KEY */}
        <section className="s" id="byok"><div className="wrap">
          <SectionHead eyebrow="Bring your own key" lines={[['Bring your key.'], ['Start building.']]}
            sub="AgentForge is open source. Connect your own Claude API key and you are ready to go." />
          <KeyVault />
        </div></section>

        <Compare />

        {/* LINT */}
        <section className="s" id="lint"><div className="wrap">
          <div className="split rv" style={{ alignItems: 'center', marginTop: 0 }}>
            <div>
              <div className="eyebrow">Compliance lint</div>
              <Split className="t" style={{ fontSize: 'clamp(28px,3.6vw,44px)' }} lines={[['Catch the old law'], ['before it ships.']]} />
              <p className="sub" style={{ fontSize: 17 }}>The Income-tax Act 2025 took effect on 1 April 2026. There is no 194C, 194I or 194J. Paste a design sentence and see the lint.</p>
            </div>
            <Lint />
          </div>
        </div></section>

        <Stats />
        <Faq />
        <Cta />
      </main>
      <Footer />
      <MotionInit />
    </>
  )
}
