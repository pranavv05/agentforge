'use client';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { useSignedIn } from './use-signed-in';

interface Item {
  href: string;
  icon: string;
  tone?: '' | 'g' | 'v' | 'o';
  title: string;
  desc: string;
}
interface Menu {
  label: string;
  cols: { h: string; items: Item[] }[];
}

const MENUS: Menu[] = [
  {
    label: 'Product',
    cols: [
      {
        h: 'Platform',
        items: [
          {
            href: '/product/pipeline',
            icon: 'fa-diagram-project',
            title: 'Governed pipeline',
            desc: 'Explore the state machine and try to break the rules',
          },
          {
            href: '/product/grounding',
            icon: 'fa-shield-halved',
            tone: 'g',
            title: 'Grounding verifier',
            desc: 'Check any claim against a real file and line',
          },
          {
            href: '/product/compliance',
            icon: 'fa-scale-balanced',
            tone: 'v',
            title: 'Compliance pack',
            desc: 'GST and TDS Section 393 rules, with a TDS calculator',
          },
        ],
      },
      {
        h: 'Under the hood',
        items: [
          {
            href: '/docs/concepts',
            icon: 'fa-lock',
            title: 'Core concepts',
            desc: 'Pipeline, approvals, audit log, edit hook',
          },
          {
            href: '/docs/grounding-compliance',
            icon: 'fa-magnifying-glass',
            tone: 'o',
            title: 'Grounding and compliance',
            desc: 'How claims are verified, how rules apply',
          },
          {
            href: '/resources/edit-hook',
            icon: 'fa-plug',
            tone: 'g',
            title: 'Edit hook',
            desc: 'See when your coding agent may write code',
          },
        ],
      },
    ],
  },
  {
    label: 'Resources',
    cols: [
      {
        h: 'Learn',
        items: [
          {
            href: '/docs',
            icon: 'fa-book-open',
            title: 'Documentation',
            desc: 'Guides, concepts and reference',
          },
          {
            href: '/docs/quickstart',
            icon: 'fa-rocket',
            tone: 'v',
            title: 'Quickstart',
            desc: 'Your first spec in five minutes',
          },
          {
            href: '/docs/api',
            icon: 'fa-code',
            tone: 'o',
            title: 'API reference',
            desc: 'Endpoints, request bodies and examples',
          },
          {
            href: '/docs/changelog',
            icon: 'fa-clock-rotate-left',
            tone: 'g',
            title: 'Changelog',
            desc: 'What changed in each release',
          },
        ],
      },
      {
        h: 'Tools',
        items: [
          {
            href: '/resources/edit-hook',
            icon: 'fa-hand',
            tone: 'g',
            title: 'Edit-hook tester',
            desc: 'Pick a state and a tool, get allow or deny',
          },
          {
            href: '/resources/errors',
            icon: 'fa-triangle-exclamation',
            tone: 'o',
            title: 'Error decoder',
            desc: 'Look up any error code and its fix',
          },
          {
            href: '/resources/templates',
            icon: 'fa-file-arrow-down',
            tone: 'v',
            title: 'Spec templates',
            desc: 'EARS requirements, grounded design, tasks',
          },
          {
            href: '/resources',
            icon: 'fa-grip',
            title: 'All resources',
            desc: 'Everything in one place',
          },
        ],
      },
    ],
  },
  {
    label: 'Compare',
    cols: [
      {
        h: 'Versus',
        items: [
          {
            href: '/compare/spec-kit',
            icon: 'fa-code-branch',
            title: 'GitHub Spec Kit',
            desc: 'Prompt templates inside an agent chat',
          },
          {
            href: '/compare/openspec',
            icon: 'fa-file-circle-check',
            tone: 'g',
            title: 'OpenSpec',
            desc: 'Lightweight propose, apply, archive',
          },
          {
            href: '/compare/kiro',
            icon: 'fa-laptop-code',
            tone: 'o',
            title: 'Kiro',
            desc: 'AWS spec-driven IDE',
          },
        ],
      },
      {
        h: '\u00a0',
        items: [
          {
            href: '/compare/bmad',
            icon: 'fa-users-gear',
            tone: 'v',
            title: 'BMAD-METHOD',
            desc: '21 personas, 50+ workflows',
          },
          {
            href: '/compare/spec-workflow-mcp',
            icon: 'fa-plug-circle-check',
            title: 'Spec Workflow MCP',
            desc: 'The closest neighbour',
          },
          {
            href: '/compare#fit',
            icon: 'fa-compass',
            tone: 'g',
            title: 'Which one fits you?',
            desc: 'Four questions, one honest answer',
          },
        ],
      },
    ],
  },
];

const MOBILE = [
  ['/product/pipeline', 'Governed pipeline'],
  ['/product/grounding', 'Grounding verifier'],
  ['/product/compliance', 'Compliance pack'],
  ['/resources', 'Resources'],
  ['/compare', 'Compare'],
  ['/docs', 'Documentation'],
];

const Chev = () => (
  <svg className="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M1.5 3.5L5 7l3.5-3.5" />
  </svg>
);

export function Nav() {
  const signedIn = useSignedIn();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(scrollY > 8);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('#menu')) setOpen(null);
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDoc);
    return () => {
      removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDoc);
    };
  }, []);

  const hoverable = () => matchMedia('(hover:hover)').matches;

  return (
    <header className={'nav' + (scrolled ? ' scrolled' : '')} id="top-nav">
      <div className="wrap nav-in">
        <Logo />
        <ul className="menu" id="menu" style={{ padding: 0 }}>
          {MENUS.map((m, i) => (
            <li
              key={m.label}
              className={open === i ? 'open' : ''}
              onMouseEnter={() => {
                if (hoverable()) setOpen(i);
              }}
              onMouseLeave={() => {
                if (hoverable()) setOpen((o) => (o === i ? null : o));
              }}
            >
              <button
                type="button"
                aria-expanded={open === i}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(open === i ? null : i);
                }}
              >
                {m.label} <Chev />
              </button>
              <div
                className="mega"
                onClick={() => {
                  setOpen(null);
                }}
              >
                {m.cols.map((c) => (
                  <div key={c.h}>
                    <h6>{c.h}</h6>
                    {c.items.map((it) => (
                      <a className="mi" href={it.href} key={it.href + it.title}>
                        <span className={'ic ' + (it.tone ?? '')}>
                          <i className={'fa-solid ' + it.icon} />
                        </span>
                        <div>
                          <b>{it.title}</b>
                          <span>{it.desc}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </li>
          ))}
          <li>
            <a href="/#faq">FAQ</a>
          </li>
        </ul>
        <div className="nav-r">
          {signedIn ? (
            <a className="btn dark sm" href="/workspace">
              Open dashboard
            </a>
          ) : (
            <>
              <a className="btn ghost sm hide-m" href="/sign-in">
                Sign in
              </a>
              <a className="btn dark sm" href="/sign-up">
                <i className="fa-solid fa-user-plus" /> Sign up
              </a>
            </>
          )}
          <button
            className="burger"
            id="burger"
            aria-label="Menu"
            aria-expanded={mobile}
            onClick={() => {
              setMobile((v) => !v);
            }}
          >
            <i className="fa-solid fa-bars" />
          </button>
        </div>
      </div>
      <nav
        className={'mobile' + (mobile ? ' open' : '')}
        id="mobile"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setMobile(false);
        }}
      >
        {MOBILE.map(([h, t]) => (
          <a href={h} key={h}>
            {t}
          </a>
        ))}
        {signedIn ? (
          <a href="/workspace">Dashboard</a>
        ) : (
          <>
            <a href="/sign-in">Sign in</a>
            <a href="/sign-up">Sign up</a>
          </>
        )}
      </nav>
    </header>
  );
}
