window.__ModuleLoader__.load({
  id: "dsh-superwork",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let React;
    try { React = require("react"); } catch (e) { console.error("[superwork] react unavailable:", e); return module.exports; }

    const CSS = [
      ".ct-root{position:relative;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}",
      ".ct-trigger{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font:inherit;cursor:pointer}",
      ".ct-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:40;min-width:260px;max-width:360px;max-height:min(420px,70vh);overflow:auto;box-sizing:border-box;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv3)}",
      ".ct-title{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}",
      ".ct-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font:inherit;cursor:pointer}",
      ".ct-error{color:var(--dsw-alias-state-error-primary);margin:0 0 6px}",
      ".ct-node{margin:0;padding:0;list-style:none}",
      ".ct-item{margin:0;padding:0}",
      ".ct-rowwrap{display:flex;align-items:stretch;gap:2px}",
      ".ct-toggle{flex:none;width:18px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
      ".ct-toggle[aria-hidden=true]{visibility:hidden}",
      ".ct-row{flex:1;text-align:left;border:0;background:transparent;color:inherit;border-radius:6px;padding:4px 6px;display:flex;flex-direction:column;gap:1px;cursor:pointer}",
      ".ct-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".ct-row[data-current=true]{background:var(--dsw-alias-interactive-bg-hover)}",
      ".ct-label{font-weight:600}",
      ".ct-meta{color:var(--dsw-alias-label-tertiary)}",
      ".ct-children{margin:0 0 0 16px;padding:0 0 0 6px;border-left:1px solid var(--dsw-alias-border-l2);list-style:none}",
      ".ct-empty{color:var(--dsw-alias-label-tertiary);margin:0}",
      // ---- superwork 右栏页（只列当前根的直属执行/审查代理）----
      ".sw{padding:12px 12px 24px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:10px;overflow:auto;height:100%;box-sizing:border-box}",
      ".sw-h{display:flex;align-items:center;gap:8px;margin:0 2px 2px}",
      ".sw-h b{font-size:13px;letter-spacing:.2px;font-weight:650}",
      ".sw-logo{flex:none;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 72%,#8ab4ff),var(--dsw-alias-state-business-primary));box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}",
      ".sw-h .sum{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".sw-h button{margin-left:auto;flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:2px 8px;font:inherit;font-size:11.5px;cursor:pointer}",
      ".sw-h button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".sw-grp{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:5px;display:flex;flex-direction:column;transition:border-color .12s}",
      ".sw-grp:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 55%,var(--dsw-alias-border-l2))}",
      ".sw-row{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:inherit;text-align:left;border-radius:8px;padding:7px 9px;font:inherit;cursor:pointer;min-width:0}",
      ".sw-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sw-row[data-current=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent)}",
      ".sw-row .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
      ".sw-row.l1 .nm{font-size:13px}",
      ".sw-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-border-l2)}",
      ".sw-dot[data-s=running]{background:var(--dsw-alias-state-business-primary);animation:sw-pulse 2.2s ease-out infinite}",
      ".sw-dot[data-s=waiting]{background:transparent;box-shadow:inset 0 0 0 1.5px var(--dsw-alias-state-business-primary)}",
      ".sw-dot[data-s=blocked]{background:var(--dsw-alias-state-error-primary)}",
      ".sw-dot[data-s=complete]{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 45%,transparent)}",
      "@keyframes sw-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}",
      ".sw-chip{flex:none;font-size:10px;line-height:15px;padding:0 6px;border-radius:99px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 13%,transparent)}",
      ".sw-chip[data-k=review]{background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}",
      ".sw-st{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".sw-st[data-s=running]{color:var(--dsw-alias-state-business-primary);font-weight:550}",
      ".sw-st[data-s=blocked]{color:var(--dsw-alias-state-error-primary)}",
      ".sw-kids{position:relative;margin:1px 2px 3px 16px;padding-left:9px;display:flex;flex-direction:column}",
      ".sw-kids::before{content:\"\";position:absolute;left:0;top:3px;bottom:7px;width:1px;background:var(--dsw-alias-border-l2)}",
      ".sw-kids .sw-row{padding:5px 8px;font-size:12px}",
      ".sw-kids .sw-row .nm{font-weight:500}",
      ".sw-kids .sw-dot{width:6.5px;height:6.5px}",
      ".sw-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:28px 14px;text-align:center;color:var(--dsw-alias-label-tertiary)}",
      ".sw-empty .g{display:block;font-size:17px;margin-bottom:6px;opacity:.7}",
      ".sw-empty .h{display:block;margin-top:3px;font-size:11px;opacity:.85}",
      ".wf{--wf-fg:var(--dsw-alias-label-primary);--wf-fg2:var(--dsw-alias-label-secondary);--wf-fg3:var(--dsw-alias-label-tertiary);--wf-line:var(--dsw-alias-border-l2);--wf-bg:var(--dsw-alias-bg-layer-3);--wf-bg2:var(--dsw-alias-bg-layer-2);--wf-accent:var(--dsw-alias-state-business-primary);width:100%;max-width:1040px;color:var(--wf-fg);font-size:13px;line-height:20px;padding-bottom:64px}",
      ".wf-lede{margin:0 0 18px;color:var(--wf-fg3);font-size:12.5px;line-height:19px;max-width:640px}",
      ".wf-cols{display:block;margin-bottom:22px}",
      ".wf-col-h{font-size:11.5px;color:var(--wf-fg3);letter-spacing:.4px;margin:0 0 8px 2px}",
      ".wf-col-h b{color:var(--wf-fg2);font-weight:600;letter-spacing:0;font-size:12px;margin-right:6px}",
      ".wf-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}",
      ".wf-card{appearance:none;text-align:left;border:1px solid var(--wf-line);background:var(--wf-bg);border-radius:10px;padding:9px 24px 9px 11px;cursor:pointer;color:var(--wf-fg);font:inherit;display:flex;flex-direction:column;gap:3px;min-width:0;transition:border-color .12s,box-shadow .12s,opacity .12s;position:relative}",
      ".wf-card:hover{border-color:var(--wf-fg3)}",
      ".wf-card[aria-selected=true]{border-color:var(--wf-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-accent) 14%,transparent)}",
      ".wf-card[data-off=true]{opacity:.55;border-style:dashed}",
      ".wf-card .n{display:flex;align-items:center;gap:6px;min-width:0}",
      ".wf-card .n b{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wf-card .n i{font-style:normal;font-size:10.5px;color:var(--wf-fg3);border:1px solid var(--wf-line);border-radius:4px;padding:0 4px;line-height:15px;flex:none}",
      ".wf-card .m{font-size:11px;color:var(--wf-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wf-dot{position:absolute;right:10px;top:11px;width:7px;height:7px;border-radius:50%;background:var(--wf-line)}",
      ".wf-add{appearance:none;border:1px dashed var(--wf-line);background:transparent;border-radius:10px;padding:8px 11px;color:var(--wf-fg3);font:inherit;font-size:12px;cursor:pointer;text-align:left}",
      ".wf-add:hover{border-color:var(--wf-fg3);color:var(--wf-fg2)}",
      ".wf-danger{border:1px solid var(--wf-line);border-radius:8px;background:transparent;color:var(--dsw-alias-state-error-primary);padding:0 12px;height:32px;font:inherit;cursor:pointer;margin-left:auto}",
      ".wf-card[data-on=true] .wf-dot{background:var(--wf-accent)}",
      ".wf-panel{border-top:1px solid var(--wf-line)}",
      ".wf-panel-head{display:flex;align-items:baseline;gap:12px;padding:16px 0 4px}",
      ".wf-panel-head h3{margin:0;font-size:15px;font-weight:600}",
      ".wf-panel-head p{margin:0;color:var(--wf-fg3);font-size:12.5px;flex:1 1 auto;min-width:0}",
      ".wf-panel-head .right{margin-left:auto}",
      ".wf-field{display:grid;grid-template-columns:168px minmax(0,1fr);gap:0 24px;padding:14px 0;border-bottom:1px solid var(--wf-line);align-items:center}",
      ".wf-field:last-child{border-bottom:0}",
      ".wf-field:has(textarea){align-items:start}",
      ".wf-field:has(textarea) .k{padding-top:6px}",
      ".wf-field .k{font-size:13px;color:var(--wf-fg)}",
      ".wf-field .k small{display:block;font-size:11.5px;color:var(--wf-fg3);line-height:16px;margin-top:2px;font-weight:400}",
      ".wf-field .v{min-width:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".wf select,.wf input,.wf textarea{box-sizing:border-box;border:1px solid var(--wf-line);background:var(--wf-bg);color:var(--wf-fg);font:inherit;font-size:13px;height:34px;padding:0 10px;border-radius:8px;transition:border-color .12s,box-shadow .12s;min-width:0}",
      ".wf select{appearance:none;-webkit-appearance:none;padding-right:28px;background-image:linear-gradient(45deg,transparent 50%,var(--wf-fg3) 50%),linear-gradient(135deg,var(--wf-fg3) 50%,transparent 50%);background-position:calc(100% - 15px) 14px,calc(100% - 10px) 14px;background-size:5px 5px;background-repeat:no-repeat}",
      ".wf select:hover,.wf input:hover,.wf textarea:hover{border-color:var(--wf-fg3)}",
      ".wf select:focus,.wf input:focus,.wf textarea:focus{outline:0;border-color:var(--wf-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-accent) 16%,transparent);position:relative;z-index:1}",
      ".wf select:disabled{opacity:.5}",
      ".wf-seg{display:flex;flex:1 1 100%;min-width:0}",
      ".wf-seg select{border-radius:0;margin-left:-1px}",
      ".wf-seg select:first-child{border-radius:8px 0 0 8px;margin-left:0;flex:0 1 160px}",
      ".wf-seg select:nth-child(2){flex:1 1 220px}",
      ".wf-seg select:last-child{border-radius:0 8px 8px 0;flex:0 1 130px}",
      ".wf-two{display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1 1 100%;min-width:0}",
      ".wf-num{display:inline-flex;align-items:center;gap:8px;color:var(--wf-fg2);font-size:12.5px;white-space:nowrap}",
      ".wf-num input{width:72px;text-align:right;font-variant-numeric:tabular-nums;padding:0 10px}",
      ".wf-num + .wf-num{margin-left:10px}",
      ".wf textarea{height:auto;min-height:72px;padding:8px 10px;line-height:19px;resize:vertical;width:100%}",
      ".wf-switch{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--wf-fg2);cursor:pointer;user-select:none;white-space:nowrap}",
      ".wf-switch input{position:absolute;opacity:0;width:0;height:0}",
      ".wf-switch i{position:relative;width:32px;height:18px;border-radius:999px;background:var(--wf-line);transition:background .15s;flex:none}",
      ".wf-switch i::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}",
      ".wf-switch input:checked+i{background:var(--wf-accent)}",
      ".wf-switch input:checked+i::after{transform:translateX(14px)}",
      ".wf-muted{color:var(--wf-fg3)}",
      ".wf-bar{position:sticky;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:12px 0 4px;margin-top:6px;background:linear-gradient(to top,var(--wf-bg) 75%,transparent)}",
      ".wf-bar .hint{font-size:12px;color:var(--wf-fg3);margin-right:auto}",
      ".wf-bar .hint.dirty{color:var(--wf-fg2)}",
      ".wf-bar .hint.err{color:var(--dsw-alias-state-error-primary)}",
      ".wf-save{border:0;border-radius:8px;background:var(--wf-accent);color:#fff;padding:0 18px;height:34px;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.14)}",
      ".wf-save:disabled{opacity:.45;cursor:default;box-shadow:none}",
      ".wf-ghost{border:1px solid var(--wf-line);border-radius:8px;background:transparent;color:var(--wf-fg2);padding:0 14px;height:34px;font:inherit;cursor:pointer}",
      ".wf-ghost:disabled{opacity:.45;cursor:default}",
    ].join("");

    // ── 错误边界：任何子组件崩溃只降级为占位，不炸整页 ──
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(error) { console.error("[superwork] component crashed:", error); }
      render() {
        if (this.state.failed) {
          const fallback = this.props.fallback || React.createElement("p", { className: "ct-empty" }, "组件不可用");
          return React.createElement(React.Fragment, null, fallback);
        }
        return this.props.children;
      }
    }

    // 返回的必须是"组件"（函数），不是已创建的元素——slots.register 拿元素当组件会什么都不画。
    function safe(label, fallbackText, Comp) {
      if (typeof Comp !== "function") return null;
      const Safe = (props) => React.createElement(Boundary, { label, fallback: React.createElement("p", { className: "ct-empty" }, fallbackText) }, React.createElement(Comp, props));
      Safe.displayName = "Safe(" + label + ")";
      return Safe;
    }
    function modelLabel(node) {
      try {
        const route = [node.provider, node.model].filter(Boolean).join("/");
        if (route && node.reasoningEffort) return route + " · " + node.reasoningEffort;
        return route || node.reasoningEffort || "";
      } catch { return ""; }
    }

    function primaryNodes(nodes) {
      const list = Array.isArray(nodes) ? nodes : [];
      if (list.length === 1 && list[0] && list[0].depth === 0) return list[0].children || [];
      return list.filter((node) => node && node.depth === 1);
    }

    function defaultExpanded(nodes, currentId) {
      const expanded = {};
      const visit = (list, parents) => {
        for (const node of Array.isArray(list) ? list : []) {
          if (!node || typeof node !== "object") continue;
          if (node.id === currentId) { for (const parentId of parents) expanded[parentId] = true; }
          visit(node.children, [...parents, node.id]);
        }
      };
      visit(nodes, []);
      return expanded;
    }

    function createOpenThreadAction({ postOpen, openSession }) {
      return async function openThread(id) {
        try { await postOpen(id); } catch (e) { console.error("[superwork] open failed:", e); }
        try { openSession(id); } catch (e) { console.error("[superwork] openSession failed:", e); }
        return id;
      };
    }

    async function api(path, options) {
      const response = await fetch(path, {
        cache: "no-store",
        headers: { accept: "application/json", ...(options && options.body ? { "content-type": "application/json" } : {}) },
        ...options,
      });
      const body = await response.text();
      let result;
      try { result = JSON.parse(body); } catch { throw new Error("工作流主机接口未挂载（HTTP " + response.status + "）"); }
      if (!result || result.ok === false) throw new Error(result && result.error ? result.error : "HTTP " + response.status);
      return result;
    }

    function NodeList({ nodes, onOpen, expanded, toggle, level, currentId }) {
      const list = Array.isArray(nodes) ? nodes : [];
      if (list.length === 0) {
        return level === 1 ? React.createElement("p", { className: "ct-empty" }, "还没有一级线程") : null;
      }
      return React.createElement("ul", { className: level === 1 ? "ct-node" : "ct-children" }, list.map((node) => {
        const children = Array.isArray(node.children) ? node.children : [];
        const hasChildren = children.length > 0;
        const open = expanded[node.id] === true;
        const model = modelLabel(node);
        return React.createElement("li", { key: node.id, className: "ct-item" },
          React.createElement("div", { className: "ct-rowwrap" },
            React.createElement("button", {
              type: "button", className: "ct-toggle",
              "aria-hidden": hasChildren ? undefined : "true",
              "aria-expanded": hasChildren ? open : undefined,
              onClick: (event) => { event.preventDefault(); event.stopPropagation(); if (hasChildren) toggle(node.id); },
            }, hasChildren ? (open ? "▾" : "▸") : ""),
            React.createElement("button", {
              type: "button", className: "ct-row",
              "data-current": node.id === currentId ? "true" : undefined,
              onClick: () => { try { onOpen(node.id); } catch (e) { console.error("[superwork] open failed:", e); } },
            },
              React.createElement("span", { className: "ct-label" }, node.label || node.id),
              React.createElement("span", { className: "ct-meta" }, [("L" + (node.depth ?? "?")), node.role || "thread", node.permission || "?", node.status || "idle", model].filter(Boolean).join(" · ")),
            ),
          ),
          hasChildren && open ? React.createElement(NodeList, { nodes: children, onOpen, expanded, toggle, level: level + 1, currentId }) : null,
        );
      }));
    }

    function CompanyThreadTree({ sessionId, openThread }) {
      const [state, setState] = React.useState({ status: "loading" });
      const [open, setOpen] = React.useState(false);
      const [expanded, setExpanded] = React.useState({});
      const rootRef = React.useRef(null);

      const load = React.useCallback(() => {
        api("/superwork/tree?rootId=" + encodeURIComponent(sessionId)).then((result) => {
          const tree = Array.isArray(result.tree) ? result.tree : [];
          setState({ status: "ready", tree });
          setExpanded((current) => ({ ...defaultExpanded(tree, sessionId), ...current }));
        }, (error) => {
          console.error("[superwork] tree load failed:", error);
          setState({ status: "error", error: (error && error.message) ? error.message : String(error) });
        });
      }, [sessionId]);

      React.useEffect(() => { if (open) load(); }, [load, open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const closeOutside = (event) => {
          try {
            if (event.target instanceof Node && !rootRef.current || (rootRef.current && !rootRef.current.contains(event.target))) setOpen(false);
          } catch { /* ignore */ }
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
      }, [open]);

      const toggle = (id) => setExpanded((current) => ({ ...current, [id]: !current[id] }));

      const choose = async (id) => {
        try {
          if (typeof openThread === "function") await openThread(id);
        } catch (e) { console.error("[superwork] choose failed:", e); }
        setOpen(false);
      };

      try {
        return React.createElement("div", { className: "ct-root", ref: rootRef },
          React.createElement("button", { type: "button", className: "ct-trigger", "aria-haspopup": "tree", "aria-expanded": open, onClick: () => setOpen((value) => !value) }, "组织树"),
          open ? React.createElement("div", { className: "ct-menu", role: "tree" },
            state.status === "loading" ? React.createElement("p", { className: "ct-empty" }, "正在读取组织树…") : null,
            state.status === "error" ? React.createElement(React.Fragment, null,
              React.createElement("p", { className: "ct-error", role: "alert" }, state.error),
              React.createElement("button", { type: "button", className: "ct-btn", onClick: load }, "重试"),
            ) : null,
            state.status === "ready" ? React.createElement(React.Fragment, null,
              React.createElement("div", { className: "ct-title" },
                React.createElement("strong", null, "组织树"),
                React.createElement("button", { type: "button", className: "ct-btn", onClick: load }, "刷新"),
              ),
              React.createElement(NodeList, { nodes: primaryNodes(state.tree), onOpen: choose, expanded, toggle, level: 1, currentId: sessionId }),
            ) : null,
          ) : null,
        );
      } catch (e) {
        console.error("[superwork] tree render crashed:", e);
        return null;
      }
    }

    function roleControls({ roleKey, value, presets, templates, providers, onChange }) {
      const number = (field, min, max) => React.createElement("input", { type: "number", min, max, value: value[field], onChange: (event) => onChange(field, Number(event.target.value)) });
      const chosen = providers.find((item) => item.id === value.provider);
      const modelIds = chosen ? chosen.models.map((item) => item.id) : [];
      const chosenModel = chosen && chosen.models.find((item) => item.id === value.model);
      const efforts = chosenModel && chosenModel.reasoning && Array.isArray(chosenModel.reasoning.efforts) ? chosenModel.reasoning.efforts.map((item) => item.id) : [];
      if (value.reasoningEffort && !efforts.includes(value.reasoningEffort)) efforts.unshift(value.reasoningEffort);
      return {
        agentPreset: React.createElement("select", { value: value.agentPreset, onChange: (event) => onChange("agentPreset", event.target.value) },
          presets.map((item) => React.createElement("option", { key: item.id, value: item.id }, (item.name || item.id) + (item.broken ? "（不可用）" : "")))),
        provider: React.createElement("select", { "aria-label": "模型提供方", value: value.provider || "", onChange: (event) => { onChange("provider", event.target.value); onChange("model", ""); onChange("reasoningEffort", ""); } },
          React.createElement("option", { value: "" }, "选择提供方"),
          providers.map((item) => React.createElement("option", { key: item.id, value: item.id }, item.name))),
        model: React.createElement("select", { "aria-label": "模型", value: value.model || "", disabled: !chosen, onChange: (event) => { onChange("model", event.target.value); onChange("reasoningEffort", ""); } },
          React.createElement("option", { value: "" }, chosen ? "选择模型" : "先选提供方"),
          modelIds.map((id) => React.createElement("option", { key: id, value: id }, id))),
        reasoningEffort: React.createElement("select", { "aria-label": "思考程度", value: value.reasoningEffort || "", disabled: !chosenModel || !efforts.length, onChange: (event) => onChange("reasoningEffort", event.target.value) },
          React.createElement("option", { value: "" }, chosenModel && efforts.length ? "默认" : "由模型定"),
          efforts.map((id) => React.createElement("option", { key: id, value: id }, id))),
        permission: React.createElement("select", { value: value.kind === "review" ? "read-only" : value.permission, disabled: value.kind === "review", onChange: (event) => onChange("permission", event.target.value) },
          Object.values(templates).map((item) => React.createElement("option", { key: item.id, value: item.id }, item.name))),
        startGoal: React.createElement("label", { className: "wf-switch" }, React.createElement("input", { type: "checkbox", checked: value.startGoal, onChange: (event) => onChange("startGoal", event.target.checked) }), React.createElement("i", null), value.startGoal ? "开启" : "关闭"),
        maxGoalRounds: number("maxGoalRounds", 1, 256),
        maxChildren: number("maxChildren", 1, 32),
        instructions: React.createElement("textarea", { value: value.instructions, placeholder: "给这一级的附加指令，可留空", onChange: (event) => onChange("instructions", event.target.value) }),
      };
    }

    const KIND_LABEL = { work: "执行", review: "审查" };
    const FIELD_HELP = {
      name: "卡片名字。派工时用它指定：create_thread profile=名字。",
      kind: "执行做活，审查只审不改；同一列里两种都可以有。",
      route: "这张卡开出的会话用哪家、哪个模型、想多深。留空的项跟随上级当时的选择。",
      preset: "决定它有哪些工具和系统提示。",
      permission: "只能同级或缩小；审查建议只读。",
      budget: "goal 最多跑几轮。工作代理不能再开下级。",
      goal: "创建后立刻把任务书立成 goal，让它自己循环推进。",
      instructions: "在任务书之外，固定塞给这张卡的话。",
      enabled: "停用的卡不参与派工，也不出现在默认选择里。",
    };

    function Field({ label, help, children }) {
      return React.createElement("div", { className: "wf-field" },
        React.createElement("div", { className: "k" }, label, help ? React.createElement("small", null, help) : null),
        React.createElement("div", { className: "v" }, children));
    }

    function summaryOf(card) {
      const model = card.model ? card.model.split("/").pop() : "";
      const route = [card.provider, model].filter(Boolean).join(" · ") || "跟随上级";
      return route + "　" + (card.permission || "");
    }

    function CardPanel({ card, presets, templates, providers, onChange, onRemove }) {
      const c = roleControls({ roleKey: card.kind, value: card, presets, templates, providers, onChange });
      return React.createElement("div", { className: "wf-panel", role: "tabpanel" },
        React.createElement("div", { className: "wf-panel-head" },
          React.createElement("h3", null, card.name || "（未命名）"),
          React.createElement("p", null, "工作代理线程 · " + (KIND_LABEL[card.kind] || card.kind)),
          React.createElement("span", { className: "right", style: { display: "inline-flex", gap: 12, alignItems: "center" } },
            React.createElement("label", { className: "wf-switch" }, React.createElement("input", { type: "checkbox", checked: card.enabled, onChange: (e) => onChange("enabled", e.target.checked) }), React.createElement("i", null), card.enabled ? "已启用" : "已停用"),
            React.createElement("button", { type: "button", className: "wf-danger", onClick: onRemove }, "删除"))),
        React.createElement(Field, { label: "名称", help: FIELD_HELP.name }, React.createElement("input", { type: "text", value: card.name, maxLength: 24, required: true, placeholder: "必填", style: { maxWidth: 260 }, onChange: (e) => onChange("name", e.target.value), onBlur: (e) => { if (!e.target.value.trim()) onChange("name", card.name || "未命名"); } })),
        React.createElement(Field, { label: "类型", help: FIELD_HELP.kind },
          React.createElement("select", { value: card.kind, style: { maxWidth: 200 }, onChange: (e) => onChange("kind", e.target.value) },
            React.createElement("option", { value: "work" }, "执行"), React.createElement("option", { value: "review" }, "审查"))),
        React.createElement(Field, { label: "模型路由", help: FIELD_HELP.route }, React.createElement("div", { className: "wf-seg" }, c.provider, c.model, c.reasoningEffort)),
        React.createElement(Field, { label: "预设与权限", help: FIELD_HELP.preset + " " + FIELD_HELP.permission }, React.createElement("div", { className: "wf-two" }, c.agentPreset, c.permission)),
        React.createElement(Field, { label: "预算", help: FIELD_HELP.budget },
          React.createElement("span", { className: "wf-num" }, c.maxGoalRounds, "轮 goal")),
        React.createElement(Field, { label: "自动建立 goal", help: FIELD_HELP.goal }, c.startGoal),
        React.createElement(Field, { label: "附加指令", help: FIELD_HELP.instructions }, c.instructions));
    }

    function newCard(index, kind = "work") {
      const base = { id: kind + "-" + Date.now().toString(36) + "-" + index, name: (kind === "review" ? "审查代理 " : "执行代理 ") + (index + 1), enabled: true, kind, agentPreset: "xiaok-creative", provider: "", model: "", reasoningEffort: "", permission: kind === "review" ? "read-only" : "auto", startGoal: true, maxGoalRounds: 16, maxChildren: 0, instructions: "" };
      return base;
    }

    function RoleBands({ settings, presets, templates, providers, update, setProfiles }) {
      const [selected, setSelected] = React.useState(0);
      const profiles = settings.profiles || [];
      const current = profiles[selected];
      const addCard = (kind) => {
        const list = [...profiles, newCard(profiles.length, kind)];
        setProfiles(list);
        setSelected(list.length - 1);
      };
      const removeCard = () => {
        if (!current) return;
        if (typeof window !== "undefined" && !window.confirm("删除角色卡「" + (current.name || "未命名") + "」？已开的线程不受影响。")) return;
        const list = profiles.filter((_, index) => index !== selected);
        setProfiles(list);
        setSelected(Math.max(0, selected - 1));
      };
      return React.createElement(React.Fragment, null,
        React.createElement("div", { className: "wf-cols" }, React.createElement("div", null,
          React.createElement("p", { className: "wf-col-h" }, React.createElement("b", null, "工作代理线程"), "全部直属根线程；执行可写，审查强制只读"),
          React.createElement("div", { className: "wf-cards", role: "tablist" },
            profiles.map((card, index) =>
              React.createElement("button", { key: card.id || index, type: "button", role: "tab", className: "wf-card", "aria-selected": selected === index, "data-off": !card.enabled, "data-on": card.enabled, onClick: () => setSelected(index) },
                React.createElement("span", { className: "wf-dot" }),
                React.createElement("span", { className: "n" }, React.createElement("b", null, card.name || "（未命名）"), React.createElement("i", null, KIND_LABEL[card.kind] || card.kind)),
                React.createElement("span", { className: "m" }, summaryOf(card)))),
            React.createElement("button", { type: "button", className: "wf-add", onClick: () => addCard("work") }, "＋ 执行代理"),
            React.createElement("button", { type: "button", className: "wf-add", onClick: () => addCard("review") }, "＋ 审查代理")))),
        current ? React.createElement(CardPanel, { key: current.id || selected, card: current, presets, templates, providers, onChange: (field, value) => update(selected, field, value), onRemove: removeCard }) : React.createElement("p", { className: "wf-lede" }, "还没有工作代理模板，添加一个执行代理或审查代理。"));
    }

    function WorkflowSettings() {
      const [state, setState] = React.useState({ status: "loading" });
      const [saving, setSaving] = React.useState(false);
      const [baseline, setBaseline] = React.useState("");
      const load = React.useCallback(() => {
        setState({ status: "loading" });
        Promise.all([api("/superwork/settings"), api("/superwork/models")]).then(([settingsResult, modelsResult]) => {
          setState({ status: "ready", settings: settingsResult.settings, presets: settingsResult.presets || [], templates: settingsResult.templates || {}, providers: modelsResult.providers || [], note: "" });
          setBaseline(JSON.stringify(settingsResult.settings));
        }, (error) => setState({ status: "error", error: error.message }));
      }, []);
      React.useEffect(() => { load(); }, [load]);
      try {
        if (state.status === "loading") return React.createElement("p", { className: "wf-lede" }, "正在读取工作流设置…");
        if (state.status === "error") return React.createElement("div", { className: "wf" }, React.createElement("p", { className: "ct-error" }, state.error), React.createElement("button", { className: "wf-ghost", onClick: load }, "重试"));
        const dirty = JSON.stringify(state.settings) !== baseline;
        const setProfiles = (profiles) => setState((current) => ({ ...current, settings: { ...current.settings, profiles }, note: "" }));
        const update = (index, field, value) => setState((current) => {
          const list = [...(current.settings.profiles || [])];
          list[index] = { ...list[index], [field]: value };
          if (field === "kind" && value === "review") list[index].permission = "read-only";
          return { ...current, settings: { ...current.settings, profiles: list }, note: "" };
        });
        const save = () => {
          setSaving(true);
          api("/superwork/settings", { method: "POST", body: JSON.stringify({ settings: state.settings }) }).then((result) => {
            setSaving(false);
            setState((current) => ({ ...current, settings: result.settings, note: "已保存，新建的线程按此执行" }));
            setBaseline(JSON.stringify(result.settings));
          }, (error) => { setSaving(false); setState((current) => ({ ...current, note: "保存失败：" + error.message })); });
        };
        const reset = () => setState((current) => ({ ...current, settings: JSON.parse(baseline), note: "" }));
        const hintClass = state.note && state.note.startsWith("保存失败") ? "hint err" : dirty ? "hint dirty" : "hint";
        return React.createElement("div", { className: "wf" },
          React.createElement("p", { className: "wf-lede" }, "使用 superwork 的普通会话默认是独立根线程。这里只配置它能直接调度的执行/审查代理模板；代理不能再开下级。执行与审查隔离，审查权限固定只读。"),
          React.createElement(RoleBands, { settings: state.settings, presets: state.presets, templates: state.templates, providers: state.providers || [], update, setProfiles }),
          React.createElement("div", { className: "wf-bar" },
            React.createElement("span", { className: hintClass }, state.note || (dirty ? "有未保存的改动" : "")),
            React.createElement("button", { type: "button", className: "wf-ghost", disabled: !dirty || saving, onClick: reset }, "放弃改动"),
            React.createElement("button", { type: "button", className: "wf-save", disabled: !dirty || saving, onClick: save }, saving ? "正在保存…" : "保存")));
      } catch (e) {
        console.error("[superwork] settings crashed:", e);
        return React.createElement("p", { className: "ct-error" }, "工作流设置不可用");
      }
    }

    // superwork 标志：与 DSH 智能体预设同款的三节点连环图（于教授选定），fill=currentColor 跟随文字色
    function swGlyph(size) {
      return React.createElement("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        React.createElement("mask", { id: "sw_glyph_mask16", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: 16, height: 16 },
          React.createElement("rect", { width: 16, height: 16, fill: "white" }),
          React.createElement("circle", { cx: 7.9995, cy: 3.28319, r: 1.712, fill: "black" }),
          React.createElement("circle", { cx: 3.51122, cy: 11.3855, r: 1.712, fill: "black" }),
          React.createElement("circle", { cx: 12.4878, cy: 11.3855, r: 1.712, fill: "black" })),
        React.createElement("path", { mask: "url(#sw_glyph_mask16)", fill: "currentColor", d: "M12.2881 11.0425C12.6002 11.3723 13.0413 11.5786 13.5312 11.5786L13.5342 11.5776C13.1476 12.3233 12.6119 12.9785 11.9639 13.5005C10.9327 14.3309 9.6199 14.8286 8.19336 14.8286C7.29864 14.8285 6.45056 14.6313 5.6875 14.2808C6.08309 14.0281 6.36707 13.6189 6.45215 13.1392C6.99022 13.3561 7.57767 13.476 8.19336 13.4761C9.30019 13.4761 10.3157 13.0915 11.1152 12.4478C11.5935 12.0626 11.9924 11.5848 12.2881 11.0425ZM4.14746 4.36475C4.25569 4.83228 4.55488 5.2247 4.95898 5.4585C4.07956 6.30639 3.53144 7.49605 3.53125 8.81396C3.53125 9.69534 3.77613 10.5202 4.20117 11.2231C3.74959 11.3817 3.38395 11.7232 3.19531 12.1597C2.5541 11.2032 2.17969 10.052 2.17969 8.81396C2.17989 7.05087 2.93868 5.4646 4.14746 4.36475ZM8.19336 2.80029C8.85717 2.80029 9.49784 2.90834 10.0967 3.10791C12.3237 3.85044 13.9725 5.86061 14.1846 8.28369C13.9832 8.20048 13.7627 8.15382 13.5312 8.15381C13.2802 8.15381 13.042 8.20907 12.8271 8.30615C12.6281 6.47264 11.3666 4.95616 9.66895 4.39014C9.2063 4.236 8.70989 4.15186 8.19336 4.15186C7.96112 4.15189 7.7329 4.16981 7.50977 4.20264C7.51947 4.12886 7.52637 4.05348 7.52637 3.97705C7.52628 3.56604 7.3811 3.18914 7.13965 2.89404C7.48183 2.83352 7.83381 2.80033 8.19336 2.80029Z" }),
        React.createElement("path", { fill: "currentColor", d: "M9.1123 3.28271C9.11205 2.66858 8.61322 2.17041 7.99902 2.17041C7.38504 2.17067 6.88697 2.66874 6.88672 3.28271C6.88672 3.89691 7.38489 4.39574 7.99902 4.396C8.61338 4.396 9.1123 3.89707 9.1123 3.28271ZM10.3115 3.28271C10.3115 4.55981 9.27612 5.59521 7.99902 5.59521C6.72214 5.59496 5.6875 4.55965 5.6875 3.28271C5.68776 2.00599 6.7223 0.971447 7.99902 0.971191C9.27596 0.971191 10.3113 2.00584 10.3115 3.28271Z" }),
        React.createElement("path", { fill: "currentColor", d: "M4.62402 11.385C4.62377 10.7709 4.12494 10.2727 3.51074 10.2727C2.89676 10.273 2.39869 10.771 2.39844 11.385C2.39844 11.9992 2.89661 12.498 3.51074 12.4983C4.1251 12.4983 4.62402 11.9994 4.62402 11.385ZM5.82324 11.385C5.82324 12.6621 4.78784 13.6975 3.51074 13.6975C2.23386 13.6973 1.19922 12.6619 1.19922 11.385C1.19947 10.1083 2.23402 9.07374 3.51074 9.07349C4.78768 9.07349 5.82299 10.1081 5.82324 11.385Z" }),
        React.createElement("path", { fill: "currentColor", d: "M13.6006 11.385C13.6003 10.7709 13.1015 10.2727 12.4873 10.2727C11.8733 10.273 11.3753 10.771 11.375 11.385C11.375 11.9992 11.8732 12.498 12.4873 12.4983C13.1017 12.4983 13.6006 11.9994 13.6006 11.385ZM14.7998 11.385C14.7998 12.6621 13.7644 13.6975 12.4873 13.6975C11.2104 13.6973 10.1758 12.6619 10.1758 11.385C10.176 10.1083 11.2106 9.07374 12.4873 9.07349C13.7642 9.07349 14.7995 10.1081 14.7998 11.385Z" }));
    }

    const ROLE_CHIP = { work: "执行", review: "审查" };
    const STATUS_CN = { running: "运行中", waiting: "待验收", blocked: "卡住", complete: "完成", idle: "待命", paused: "暂停" };

    function SwRow({ node, level, onOpen, currentId }) {
      return React.createElement("button", { type: "button", className: "sw-row" + (level === 1 ? " l1" : ""), "data-current": node.id === currentId ? "true" : undefined, title: node.label || node.id, onClick: () => onOpen(node.id) },
        React.createElement("span", { className: "sw-dot", "data-s": node.status }),
        React.createElement("span", { className: "nm" }, node.label || node.id),
        ROLE_CHIP[node.role] ? React.createElement("span", { className: "sw-chip", "data-k": node.role }, ROLE_CHIP[node.role]) : null,
        React.createElement("span", { className: "sw-st", "data-s": node.status }, STATUS_CN[node.status] || node.status || ""));
    }

    function flatten(nodes, out) { for (const n of nodes ?? []) { out.push(n); flatten(n.children, out); } return out; }

    // 右栏页：根线程不占行（当前会话即根），只列直属执行/审查代理。
    function OrgTab({ scope, onOpen }) {
      const [state, setState] = React.useState({ status: "loading" });
      const load = React.useCallback(() => {
        if (!scope?.sessionId) { setState({ status: "ready", tree: [] }); return; }
        const rootId = "?rootId=" + encodeURIComponent(scope.sessionId);
        api("/superwork/tree" + rootId).then((r) => setState({ status: "ready", tree: r.tree || [] }), (e) => setState({ status: "error", error: e.message }));
      }, [scope?.sessionId]);
      React.useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
      if (state.status === "loading") return React.createElement("div", { className: "sw" }, React.createElement("p", { className: "sw-empty" }, "正在读取…"));
      if (state.status === "error") return React.createElement("div", { className: "sw" }, React.createElement("p", { className: "ct-error" }, state.error), React.createElement("div", { className: "sw-h" }, React.createElement("button", { onClick: load }, "重试")));
      const all = flatten(state.tree, []);
      const workers = all.filter((node) => node.depth === 1 && (node.role === "work" || node.role === "review"));
      const running = workers.filter((node) => node.status === "running").length;
      const reviews = workers.filter((node) => node.role === "review").length;
      const summary = workers.length ? `${workers.length} 个代理 · ${reviews} 审查` + (running ? ` · ${running} 运行中` : "") : "";
      return React.createElement("div", { className: "sw" },
        React.createElement("div", { className: "sw-h" },
          React.createElement("span", { className: "sw-logo" }, swGlyph(13)),
          React.createElement("b", null, "superwork"),
          summary ? React.createElement("span", { className: "sum" }, summary) : null,
          React.createElement("button", { onClick: load }, "↻ 刷新")),
        workers.length === 0
          ? React.createElement("div", { className: "sw-empty" },
              React.createElement("span", { className: "g" }, "◎"),
              "还没有派出去的线程",
              React.createElement("span", { className: "h" }, "根线程派工后，直属执行/审查代理会出现在这里"))
          : workers.map((worker) => React.createElement("div", { className: "sw-grp", key: worker.id },
              React.createElement(SwRow, { node: worker, level: 1, onOpen, currentId: scope?.sessionId }))));
    }

    const inject = ["slots", "sessions"];
    function apply(ctx) {
      try {
        const slots = ctx.get("slots");
        if (!slots) { console.warn("[superwork] slots unavailable, skip"); return; }
        const sessions = ctx.get("sessions") || ctx.sessions;
        try {
          if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-superwork\"]") === null) {
            const tag = document.createElement("style");
            tag.dataset.plugin = "dsh-superwork";
            tag.dataset.pluginCss = "dsh-superwork";
            tag.textContent = CSS;
            document.head.appendChild(tag);
          }
        } catch (e) { console.error("[superwork] style injection failed:", e); }
        const openThread = createOpenThreadAction({
          postOpen: (id) => api("/superwork/open", { method: "POST", body: JSON.stringify({ id }) }),
          openSession: (id) => sessions.open(id),
        });
        // 「保持可见」归还：从右栏打开的工作代理，切走后通知服务端重新归档。
        let keptThreadId;
        const releaseKept = (nextId) => {
          const id = keptThreadId;
          keptThreadId = undefined;
          if (id && id !== nextId) api("/superwork/release", { method: "POST", body: JSON.stringify({ id }) }).catch(() => {});
        };
        const openThreadKept = async (id) => {
          if (keptThreadId && keptThreadId !== id) releaseKept(id);
          await openThread(id);
          keptThreadId = id;
        };
        try {
          const list = sessions.list;
          if (list && typeof list.subscribe === "function" && typeof list.getSnapshot === "function") {
            ctx.effect(() => list.subscribe(() => {
              const current = list.getSnapshot()?.current;
              if (keptThreadId && current !== undefined && current !== keptThreadId) releaseKept(current);
            }), "superwork: release kept thread");
          }
        } catch (e) { console.error("[superwork] release watcher failed:", e); }
        try {
          // 右侧栏「组织」页（better-sidebar 在场才注册；不在场静默跳过）
      ctx.inject(["betterSidebar"], (ictx) => {
        ictx.effect(() => ictx.betterSidebar.registerTab({
          id: "superwork:org",
          title: "superwork",
          icon: (size) => swGlyph(size ?? 16),
          component: (props) => React.createElement(OrgTab, { scope: props?.scope, onOpen: (id) => { openThreadKept(id).catch((e) => console.error("[superwork] open failed:", e)); } }),
        }));
      });
      slots.inject("settings.section", () => slots.register({ name: "settings.section", id: "workflow", order: 22, label: "工作流" }, safe("workflow-settings", "工作流设置不可用", WorkflowSettings)));
        } catch (e) { console.error("[superwork] settings.section inject failed:", e); }
        try {
          // 组织树弹窗已撤（2026-08-18 于教授：侧栏靠标题缩进和排序显示层级，不要弹出树）
          // slots.inject("conversation.session.header.actions", () => slots.register({ name: "conversation.session.header.actions", id: "company-thread-tree", order: 20, inject: () => ({ openThread }) }, safe("company-tree", "组织树不可用", CompanyThreadTree)));
        } catch (e) { console.error("[superwork] header.actions inject failed:", e); }
      } catch (e) {
        console.error("[superwork] apply failed:", e);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = "superwork-client";
    exports.primaryNodes = primaryNodes;
    exports.defaultExpanded = defaultExpanded;
    exports.createOpenThreadAction = createOpenThreadAction;
    return module.exports;
  },
});
