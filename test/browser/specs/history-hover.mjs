/**
 * Moves a real mouse across the weekly 30-day chart and a sparse Kimi-like
 * chart at three panel widths and checks the readout under the pointer.
 */
export const page = "history-hover";
export const viewport = { width: 700, height: 1400 };

/** True when the tooltip's own box or a clipping ancestor cuts its text. */
async function isCut(tooltip) {
  return tooltip.evaluate((el) => {
    if (el.scrollHeight > el.clientHeight + 1) return true;
    const rect = el.getBoundingClientRect();
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const clip = node.getBoundingClientRect();
      if (rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1 || rect.left < clip.left - 1 || rect.right > clip.right + 1) return true;
    }
    return false;
  });
}

export async function run({ page, fail, log }) {
  for (const width of [340, 400, 460]) {
    const card = page.locator(`[data-width="${width}"]`);
    await card.scrollIntoViewIfNeeded();
    const canvas = card.locator(".history-chart__canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`No canvas at ${width}px`);
    // The plot is the middle of the 136-tall viewBox. Sweep there, not along
    // the date labels under the axis.
    const plotY = box.y + box.height * (64 / 136);

    const seen = [];
    const steps = 8;
    for (let step = 0; step <= steps; step += 1) {
      const x = box.x + box.width * (0.12 + 0.76 * (step / steps));
      await page.mouse.move(x, plotY);
      await page.waitForTimeout(25);
      const text = (await canvas.locator(".history-chart__tooltip").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const guide = await canvas.locator(".history-chart__guide-active").count();
      const time = text.split("Observed")[0]?.trim() ?? "";
      if (guide < 1) throw new Error(`${width}px step ${step} has no guide (${time || "no tooltip"})`);
      if (time.length === 0) throw new Error(`${width}px step ${step} has an empty tooltip`);
      const tip = await canvas.locator(".history-chart__tooltip").boundingBox();
      if (!tip || tip.width - 0.5 > 180) {
        fail(`${width}px step ${step} tooltip is ${Math.round(tip?.width ?? 0)}px`);
      }
      if (await isCut(canvas.locator(".history-chart__tooltip"))) fail(`${width}px step ${step} tooltip is cut off`);
      // The plot grid starts 22/136 down the canvas. A tooltip above that
      // covers the card header and the status line.
      const plotTop = box.y + box.height * (22 / 136);
      if (tip && tip.y < plotTop - 1) {
        fail(`${width}px step ${step} tooltip covers the header`);
      }
      seen.push(time);
    }
    const distinct = [...new Set(seen)];
    if (distinct.length < 5) throw new Error(`${width}px showed ${distinct.length} times: ${distinct.join(" | ")}`);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const stamp = (time) => {
      const match = /([A-Z][a-z]{2}) (\d+), (\d+):(\d+) (AM|PM)/.exec(time);
      if (!match) return NaN;
      let hour = Number(match[3]) % 12;
      if (match[5] === "PM") hour += 12;
      return Date.UTC(2026, months.indexOf(match[1]), Number(match[2]), hour, Number(match[4]));
    };
    for (let index = 1; index < distinct.length; index += 1) {
      if (!(stamp(distinct[index]) > stamp(distinct[index - 1]))) {
        throw new Error(`${width}px time did not increase: ${distinct[index - 1]} -> ${distinct[index]}`);
      }
    }
    log(`${width}px ${distinct.length} times`);

    // A click pins the readout past the chart edge; a click outside clears it.
    await page.mouse.click(box.x + box.width * 0.5, plotY);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 40);
    if (await canvas.locator(".history-chart__tooltip").count() !== 1) fail(`${width}px pinned tooltip did not stay`);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height + 40);
    if (await canvas.locator(".history-chart__tooltip").count() !== 0) fail(`${width}px pinned tooltip stayed after an outside click`);

    const kimi = page.locator(`[data-kimi="${width}"]`);
    await kimi.scrollIntoViewIfNeeded();
    const kimiCanvas = kimi.locator(".history-chart__canvas");
    const plot = await kimiCanvas.boundingBox();
    if (!plot) throw new Error(`No Kimi canvas at ${width}px`);
    const hoverBox = async (selector) => {
      const target = kimiCanvas.locator(selector).first();
      const box = await target.boundingBox();
      if (!box) throw new Error(`No ${selector} at ${width}px`);
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, plot.height - 4));
      await page.waitForTimeout(25);
      const tip = kimiCanvas.locator(".history-chart__tooltip");
      if (await isCut(tip)) fail(`${width}px ${selector} tooltip is cut off`);
      return tip;
    };
    for (let step = 0; step <= 40; step += 1) {
      await page.mouse.move(plot.x + plot.width * (0.05 + 0.9 * (step / 40)), plot.y + plot.height * 0.45);
      await page.waitForTimeout(10);
      const tip = kimiCanvas.locator(".history-chart__tooltip");
      if ((await tip.count()) > 0 && (await isCut(tip))) fail(`${width}px Kimi step ${step} tooltip is cut off`);
    }
    const idleTip = await hoverBox(".history-chart__idle");
    const idleText = (await idleTip.innerText()).replace(/\s+/g, " ");
    // Kimi 5-hour is a fixed grid, so a 0% window is "no usage", not "no active window".
    if (!/No usage|Idle — no active window/.test(idleText)) fail(`${width}px idle tooltip was "${idleText}"`);
    const emptyTip = await hoverBox(".history-chart__gap");
    const emptyText = (await emptyTip.innerText()).replace(/\s+/g, " ");
    if (!/No readings/.test(emptyText)) fail(`${width}px empty tooltip was "${emptyText}"`);
    const tipBox = await emptyTip.boundingBox();
    if (tipBox && tipBox.y < plot.y + plot.height * (22 / 136) - 1) {
      fail(`${width}px tooltip covers the header`);
    }
    const highlight = await kimiCanvas.locator(".history-chart__highlight").first().boundingBox();
    const pointer = await kimiCanvas.locator(".history-chart__gap").first().boundingBox();
    if (highlight && pointer) {
      const mid = pointer.x + pointer.width / 2;
      const over = mid >= highlight.x - 2 && mid <= highlight.x + highlight.width + 2;
      if (!over) fail(`${width}px highlight misses the gap under the pointer`);
    }
  }
}
