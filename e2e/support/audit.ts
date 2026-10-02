import { expect, type Page } from '@playwright/test';

/**
 * The layout and accessibility pass, shared by every page a person meets.
 *
 * These are the faults a component test cannot see because they only exist once
 * the page has been laid out and painted: text a box cuts off, an image with no
 * alternative text, a field nobody can name, a second `h1`, a control too small
 * to hit with a thumb, or a page that scrolls sideways.
 */
export async function auditPage(page: Page, path: string) {
  // Nothing may push the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);

  const audit = await page.evaluate(() => {
    const visible = (node: HTMLElement) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return {
      // Text that is cut off by its own box and cannot be revealed by scrolling:
      // the failure that hides a validation message or half a price.
      clipped: Array.from(document.querySelectorAll<HTMLElement>('p, li, label, button, h1, h2, td, th, span'))
        .filter((node) => node.textContent?.trim() && node.getAttribute('aria-hidden') !== 'true' && visible(node))
        // A one-pixel box is the screen-reader-only pattern - a label kept for
        // assistive technology and deliberately hidden from the eye - so its
        // "clipping" is the point, not a fault.
        .filter((node) => node.clientWidth > 1 && node.clientHeight > 1)
        .filter((node) => {
          const style = getComputedStyle(node);
          if (style.overflow !== 'hidden' && style.overflowX !== 'hidden' && style.textOverflow !== 'ellipsis') return false;
          return node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2;
        })
        .map((node) => `${node.textContent?.trim().slice(0, 30)} (${node.clientWidth}x${node.clientHeight} box, ${node.scrollWidth}x${node.scrollHeight} content)`),
      missingAlt: Array.from(document.images)
        .filter((image) => visible(image) && !image.hasAttribute('alt'))
        .map((image) => image.getAttribute('src') ?? '?'),
      h1: Array.from(document.querySelectorAll('h1')).map((node) => node.textContent?.trim() ?? ''),
      unlabelled: Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
        // A control the author has taken out of the accessibility tree is not
        // missing a label, it is deliberately not announced: the rich text editor
        // keeps a hidden textarea purely to carry the submitted value, and the
        // labelled contenteditable beside it is the control a person uses.
        .filter((node) => node.getAttribute('aria-hidden') !== 'true')
        .filter((node) => visible(node) && node.type !== 'hidden' && node.type !== 'radio')
        .filter((node) => !node.labels?.length && !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby'))
        .map((node) => node.outerHTML.slice(0, 70)),
      // A control smaller than this is hard to hit on a touch screen.
      tinyTargets: Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input[type="radio"]'))
        .filter((node) => visible(node))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width < 20 || rect.height < 20;
        })
        .map((node) => `${node.textContent?.trim().slice(0, 25) || node.getAttribute('aria-label') || node.tagName} ${Math.round(node.getBoundingClientRect().width)}x${Math.round(node.getBoundingClientRect().height)}`),
      // A contenteditable field that is not announced as one is unusable with a
      // screen reader, and the rich text editor is exactly that kind of field.
      unnamedEditors: Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
        .filter((node) => !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby'))
        .map((node) => node.className || node.tagName),
    };
  });

  expect(audit.clipped, `${path} clips text it should show`).toEqual([]);
  expect(audit.missingAlt, `${path} has images without alt text`).toEqual([]);
  expect(audit.unlabelled, `${path} has form fields with no label`).toEqual([]);
  expect(audit.unnamedEditors, `${path} has an unnamed rich text editor`).toEqual([]);
  expect(audit.h1.length, `${path} has ${audit.h1.length} h1 elements`).toBe(1);
  return audit;
}