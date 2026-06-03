import Link from "next/link";
import { IS_MAINNET, VAULT_FACTORY_ADDRESS } from "@/config/contracts";

const EXPLORER = IS_MAINNET ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai";
const GITHUB = "https://github.com/RedGnad/Sentri";
const DOCS_ARCH = `${GITHUB}/blob/main/docs/architecture.md`;
const DOCS_ORACLE = `${GITHUB}/blob/main/docs/oracle-proof.md`;
const DOCS_TEE = `${GITHUB}/blob/main/docs/tee-trust-boundary.md`;

export function Footer() {
  return (
    <footer className="border-t border-hairline mt-24">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-8 lg:px-12 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">

          <div className="col-span-2 md:col-span-1">
            <p className="font-serif text-lg text-ink leading-snug mb-2">Sentri</p>
            <p className="font-mono text-[10px] text-ink-faint leading-relaxed">
              Autonomous treasury execution on 0G. Private strategy, verifiable results.
            </p>
          </div>

          <div>
            <p className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-3">Protocol</p>
            <ul className="space-y-2">
              <li>
                <Link href="/vaults" className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors">
                  Vault directory
                </Link>
              </li>
              <li>
                <Link href="/deploy" className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors">
                  Deploy a vault
                </Link>
              </li>
              <li>
                <a
                  href={`${EXPLORER}/address/${VAULT_FACTORY_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  Factory on-chain ↗
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-3">Docs</p>
            <ul className="space-y-2">
              <li>
                <a
                  href={DOCS_ARCH}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  Architecture ↗
                </a>
              </li>
              <li>
                <a
                  href={DOCS_ORACLE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  Oracle proof ↗
                </a>
              </li>
              <li>
                <a
                  href={DOCS_TEE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  TEE trust boundary ↗
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-3">Links</p>
            <ul className="space-y-2">
              <li>
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  GitHub ↗
                </a>
              </li>
              <li>
                <a
                  href={EXPLORER}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  0G Explorer ↗
                </a>
              </li>
              <li>
                <a
                  href="https://0g.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-ink-dim hover:text-ink transition-colors"
                >
                  Built on 0G ↗
                </a>
              </li>
            </ul>
          </div>

        </div>

        <div className="mt-10 pt-6 border-t border-hairline flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="font-mono text-[9px] text-ink-faint uppercase tracking-kicker">
            © MMXXVI · Sentri · MIT License
          </p>
          <a
            href="https://x.com/sentri_fi"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[9px] text-ink-faint uppercase tracking-kicker hover:text-ink transition-colors inline-flex items-center gap-1.5"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            @sentri_fi
          </a>
        </div>
      </div>
    </footer>
  );
}
