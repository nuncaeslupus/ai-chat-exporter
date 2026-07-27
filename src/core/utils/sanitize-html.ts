/**
 * Strip executable markup from an HTML string before it becomes live DOM.
 *
 * Used at re-injection points where content that started out safe (escaped
 * text, or markdown parsed by a library like `marked` that passes raw inline
 * HTML through by default) is about to be inserted into a document that will
 * actually render it — e.g. the print preview document.
 *
 * Uses a <template> element: its content is an inert DocumentFragment, so
 * parsing untrusted HTML into it never executes scripts or loads resources.
 */
export function sanitizeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  const DANGEROUS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) {
      toRemove.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const isUrlAttr = name === 'href' || name === 'src';
        if (name.startsWith('on') || (isUrlAttr && /^\s*javascript:/i.test(attr.value))) {
          node.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }

  toRemove.forEach((el) => {
    el.remove();
  });

  return template.innerHTML;
}
