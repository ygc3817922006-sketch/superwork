// 扁平工作代理标题带 ◆。下方的旧二级标题/归位函数只用于兼容已存在的 v2 历史会话。

export const ROOT_MARK = "◆";
export const MAIN_MARK = "◈";
export const CHILD_MARK = "╰";
const INDENT = "　"; // 全角空格，一格缩进

const ROLE_WORD = { work: "执行", review: "审查", project: "项目" };

/** 把线程描述符变成侧栏标题；新建线程只会出现 depth 0/1。 */
export function threadTitle(descriptor, parentLabel) {
  const label = String(descriptor?.label ?? "").trim() || descriptor?.id || "线程";
  const depth = Number(descriptor?.depth ?? 0);
  if (depth === 0) return `${MAIN_MARK} ${label}`;
  if (depth === 1) return `${ROOT_MARK} ${label}`;
  const role = ROLE_WORD[descriptor?.role] || "线程";
  const own = label === role || label.startsWith(role + " ") || label.startsWith(role + "·") ? label : `${role} · ${label}`;
  const parent = String(parentLabel ?? "").trim();
  return parent ? `${INDENT}${CHILD_MARK} ${parent} › ${own}` : `${INDENT}${CHILD_MARK} ${own}`;
}

/** 已经带过标记的标题不重复加。 */
export function isThreadTitle(title) {
  const t = String(title ?? "");
  return t.startsWith(`${ROOT_MARK} `) || t.startsWith(`${MAIN_MARK} `) || t.startsWith(`${INDENT}${CHILD_MARK} `);
}

/**
 * 算出一个二级会话应该插到谁前面：紧跟在它的一级及该一级已有的其它二级之后。
 * @param {string[]} order 当前侧栏顺序（自上而下）
 * @param {string} parentId 一级 id
 * @param {string} childId 要摆放的二级 id
 * @param {Set<string>|string[]} siblingIds 该一级名下所有二级 id（含 childId 也无妨）
 * @returns {{ move: false } | { move: true, before: string | undefined }} before 为 undefined 表示放到最后
 */
export function placementUnderParent(order, parentId, childId, siblingIds) {
  const siblings = new Set(siblingIds ?? []);
  siblings.delete(childId);
  const idx = order.indexOf(parentId);
  if (idx < 0 || !order.includes(childId)) return { move: false };
  let anchor;
  for (let i = idx + 1; i < order.length; i += 1) {
    const id = order[i];
    if (id === childId) continue;
    if (siblings.has(id)) continue;
    anchor = id;
    break;
  }
  const currentIdx = order.indexOf(childId);
  const anchorIdx = anchor === undefined ? order.length : order.indexOf(anchor);
  // 已经在正确的块里（一级之后、锚点之前）就不用动
  if (currentIdx > idx && currentIdx < anchorIdx) return { move: false };
  return { move: true, before: anchor };
}
