import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { httpUrl } from '../../lib/safeUrl';

const components: Components = {
  img: () => null,
  a: ({ href, children }) => {
    const safe = httpUrl(href);
    if (!safe) {
      return <span>{children}</span>;
    }
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

function allowHttp(url: string): string {
  return httpUrl(url) ?? '';
}

export function SafeMarkdown({ source }: { source: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={allowHttp} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
