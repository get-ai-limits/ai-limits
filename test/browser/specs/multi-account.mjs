/**
 * Renders the side panel with two accounts each of ChatGPT and Cursor and
 * checks that every account gets its own named card, that the account signed
 * out on the provider's site says so, and that Add provider offers
 * "Add account" for providers already connected.
 */
export const page = "multi-account";
export const viewport = { width: 420, height: 2400 };

export async function run({ page, fail }) {
  const cards = page.locator(".provider-card");
  const names = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label")),
  );
  for (const expected of [
    "ChatGPT, Personal",
    "ChatGPT, Work",
    "Cursor, Company",
    "Cursor, Side projects",
  ]) {
    if (!names.some((name) => name?.includes(expected.split(", ")[1]) && name.includes(expected.split(", ")[0]))) {
      fail(`missing card for ${expected}; saw ${JSON.stringify(names)}`);
    }
  }
  const otherAccount = page.getByText("A different account is signed in on this provider's site");
  if ((await otherAccount.count()) !== 1) fail("other-account message is not shown exactly once");

  if (process.env.AI_LIMITS_OVERVIEW_SHOT) {
    await page.locator("main").first().screenshot({ path: process.env.AI_LIMITS_OVERVIEW_SHOT });
  }
  await page.getByRole("button", { name: "Add provider" }).first().click();
  for (const provider of ["ChatGPT", "Cursor"]) {
    const button = page.getByRole("button", { name: `Add another ${provider} account` });
    if ((await button.count()) !== 1) fail(`no Add account button for ${provider}`);
  }
}
