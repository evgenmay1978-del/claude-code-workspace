import type { ChatMessage, ChangeFile, Project, ProjectFile } from '../types'

export const initialProjects: Project[] = [
  {
    id: 'northstar', name: 'northstar', repo: 'studio/northstar', branch: 'feat/onboarding', color: '#8faeff', mark: 'N', status: 'working', updated: 'сейчас',
    sessions: [
      { id: 'session-1', title: 'Упростить онбординг', status: 'active', updated: 'сейчас' },
      { id: 'session-2', title: 'Система токенов', status: 'idle', updated: '2 ч назад' },
      { id: 'session-3', title: 'Исправить мобильный header', status: 'done', updated: 'вчера' },
    ],
  },
  {
    id: 'atlas', name: 'atlas-api', repo: 'studio/atlas-api', branch: 'main', color: '#93e5c4', mark: 'A', status: 'ready', updated: '18 мин',
    sessions: [{ id: 'session-4', title: 'Обновить документацию API', status: 'idle', updated: '18 мин назад' }],
  },
  {
    id: 'studio', name: 'studio-site', repo: 'studio/studio-site', branch: 'design/homepage', color: '#eab2ff', mark: 'S', status: 'attention', updated: 'вчера',
    sessions: [{ id: 'session-5', title: 'Новый hero-блок', status: 'idle', updated: 'вчера' }],
  },
]

export const initialFiles: ProjectFile[] = [
  { path: 'src', kind: 'folder' },
  { path: 'src/components', kind: 'folder' },
  { path: 'src/components/Hero.tsx', kind: 'file', language: 'TypeScript React', context: true },
  { path: 'src/components/Button.tsx', kind: 'file', language: 'TypeScript React', context: true },
  { path: 'src/styles/tokens.css', kind: 'file', language: 'CSS', context: true },
  { path: 'src/pages/Home.tsx', kind: 'file', language: 'TypeScript React', context: false },
  { path: 'public', kind: 'folder' },
  { path: 'public/brand-mark.svg', kind: 'file', language: 'SVG', context: false },
  { path: 'README.md', kind: 'file', language: 'Markdown', context: true },
  { path: 'package.json', kind: 'file', language: 'JSON', context: false },
  { path: 'CLAUDE.md', kind: 'file', language: 'Инструкции', context: true },
]

export const fileContent: Record<string, string> = {
  'src/components/Hero.tsx': `import { Button } from './Button'\n\nexport function Hero() {\n  return (\n    <section className="hero">\n      <span className="eyebrow">A quieter way to build</span>\n      <h1>Focus on the work<br />that matters.</h1>\n      <p>Bring the whole project into view.</p>\n      <Button variant="primary">Explore the workspace</Button>\n    </section>\n  )\n}`,
  'src/components/Button.tsx': `type ButtonProps = {\n  children: React.ReactNode\n  variant?: 'primary' | 'quiet'\n}\n\nexport function Button({ children, variant = 'quiet' }: ButtonProps) {\n  return <button className={\`button button--\${variant}\`}>{children}</button>\n}`,
  'src/styles/tokens.css': `:root {\n  --color-ink: #13263c;\n  --color-paper: #f6f4ee;\n  --color-accent: #9eb7ff;\n  --space-4: 1rem;\n  --radius-card: 1.25rem;\n}`,
  'src/pages/Home.tsx': `import { Hero } from '../components/Hero'\n\nexport default function Home() {\n  return (\n    <main>\n      <Hero />\n    </main>\n  )\n}`,
  'public/brand-mark.svg': `<svg viewBox="0 0 64 64" aria-hidden="true">\n  <path d="M10 10h18v5H15v14h-5z" fill="currentColor"/>\n  <path d="M54 10H36v5h13v14h5z" fill="currentColor"/>\n  <path d="M10 54h18v-5H15V35h-5z" fill="currentColor"/>\n  <path d="M54 54H36v-5h13V35h5z" fill="currentColor"/>\n  <path d="m32 20 3.5 8.5L44 32l-8.5 3.5L32 44l-3.5-8.5L20 32l8.5-3.5z" fill="#FF8066"/>\n</svg>`,
  'README.md': `# Northstar\n\nA calm workspace for ambitious teams.\n\n[Read the Vite documentation](https://vite.dev) for the development guide.\n\n## Getting started\n\n\`\`\`bash\npnpm install\npnpm dev\n\`\`\`\n\n## Principles\n\n- Make the next step obvious\n- Keep the interface quiet\n- Let content take the lead\n\n| Package | Purpose |\n| --- | --- |\n| React | UI |\n| Vite | Development |`,
  'package.json': `{
  "name": "northstar-web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "vite": "^6.1.0"
  }
}`,
  'CLAUDE.md': `# Working agreements\n\n- Prefer small, focused changes.\n- Keep components accessible and keyboard-friendly.\n- Run [1mpnpm test[0m before committing.\n- Preserve the quiet, editorial tone of the product.`,
}

export const initialMessages: ChatMessage[] = [
  { id: 'm1', role: 'user', time: '11:24', content: 'Я хочу сделать первый экран продукта спокойнее, но оставить одну точку фокуса в CTA. Посмотри текущую структуру и предложи конкретный вариант.' },
  { id: 'm2', role: 'assistant', time: '11:25', content: 'Посмотрел `Hero.tsx` и `tokens.css`. Сейчас на экране конкурируют три сигнала: яркий eyebrow, крупный заголовок и две кнопки. Я бы оставил заголовок главным, а акцент собрал в одной кнопке.' },
  { id: 'm3', role: 'assistant', time: '11:26', content: 'Предлагаю начать с небольшого изменения — один primary CTA и больше воздуха между текстом и действием. Остальные ссылки можно увести ниже по визуальной иерархии.\n\n```tsx\n<Button variant="primary">Открыть рабочее пространство</Button>\n```\n\n**Что изменится:**\n- взгляд сразу попадает в заголовок;\n- CTA остаётся единственным цветовым акцентом;\n- на мобильном блок не требует перестройки.', },
]

export const initialChanges: ChangeFile[] = [
  { path: 'src/components/Hero.tsx', kind: 'M', staged: true },
  { path: 'src/styles/tokens.css', kind: 'M', staged: false },
  { path: 'src/components/Callout.tsx', kind: 'A', staged: false },
]
