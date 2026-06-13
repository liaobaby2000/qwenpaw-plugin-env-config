// QwenPaw Environment Config Plugin — Frontend
const H = window.QwenPaw.host;
const React = H.React;
const antd = H.antd;
const getApiUrl = H.getApiUrl;
const getApiToken = H.getApiToken;
const { useState, useEffect, useRef } = React;
const { Card, Button, Table, Tag, Modal, Form, Input, Select, message, Tabs, Badge, Space, Typography, Popconfirm, Divider, Row, Col } = antd;
const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

const PLUGIN_ID = "env-config";

function getParamDefault(param) {
  if (!param) return "";
  if (param.default !== undefined && param.default !== null && param.default !== "") return param.default;
  if (param.type === "select" && param.options?.[0]) return param.options[0];
  return "";
}

// ── API Helper ────────────────────────────────────────────────────────────

const tk = () => getApiToken();
const api = (path, opts = {}) => {
  const url = getApiUrl(`/env-config${path}`);
  const headers = { "Content-Type": "application/json" };
  if (tk()) headers["Authorization"] = `Bearer ${tk()}`;
  return fetch(url, { ...opts, headers }).then(r => {
    if (!r.ok) return r.json().then(e => { throw new Error(e.detail || r.statusText); });
    return r.json().then(result => {
      if (path === "/scripts" && (!opts.method || opts.method === "GET")) {
        console.log("[EnvConfig] GET /scripts result:", (result || []).map(s => ({ id: s.id, paramsKeys: Object.keys(s.params || {}) })));
      }
      return result;
    });
  });
};

// ── Execution Panel Component ─────────────────────────────────────────────

function ExecutionPanel({ logs, onClose }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  function getBgColor(type) {
    if (type === "stdout") return "#f6ffed";
    if (type === "stderr") return "#fff2f0";
    if (type === "error") return "#fff1f0";
    if (type === "info") return "#e6f7ff";
    return "#fafafa";
  }

  function getTextColor(type) {
    if (type === "error") return "#cf1322";
    if (type === "stderr") return "#d4380d";
    if (type === "info") return "#0958d9";
    if (type === "exit") return "#389e0d";
    return "#1a1a1a";
  }

  return React.createElement(Card, {
    title: "执行输出",
    size: "small",
    extra: React.createElement(Button, { size: "small", onClick: onClose }, "关闭"),
    style: { fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace", fontSize: 12, maxHeight: 400, overflow: "auto" },
    bodyStyle: { padding: 8 }
  },
    logs.length === 0 && React.createElement(Text, { type: "secondary" }, "等待执行..."),
    logs.map((log, i) =>
      React.createElement("div", { key: i, style: { background: getBgColor(log.type), color: getTextColor(log.type), padding: "2px 6px", borderRadius: 2, marginBottom: 1, whiteSpace: "pre-wrap", wordBreak: "break-all" } },
        log.type === "info" && React.createElement(Badge, { status: "processing" }),
        log.type === "exit"
          ? React.createElement("span", { style: { color: log.code === 0 ? "#389e0d" : "#cf1322", fontWeight: 500 } },
              log.code === 0 ? "✅ 完成" : `❌ 退出码: ${log.code}`
            )
          : log.line
      )
    ),
    React.createElement("div", { ref: endRef })
  );
}

// ── Script Runner Modal ───────────────────────────────────────────────────

function ScriptRunner({ script, visible, onClose, onRun }) {
  const [params, setParams] = useState({});

  useEffect(() => {
    if (!script) return;
    const defaults = {};
    Object.entries(script.params || {}).forEach(([k, v]) => { defaults[k] = getParamDefault(v); });
    setParams(defaults);
  }, [script]);

  if (!script) return null;

  return React.createElement(Modal, {
    title: `运行: ${script.name}`, visible, onCancel: onClose,
    footer: [
      React.createElement(Button, { key: "cancel", onClick: onClose }, "取消"),
      React.createElement(Button, { key: "run", type: "primary", onClick: () => onRun(script.id, params) }, "运行")
    ]
  },
    Object.keys(script.params || {}).length > 0
      ? React.createElement(Form, { layout: "vertical" },
          Object.entries(script.params).map(([key, param]) =>
            React.createElement(Form.Item, { key, label: param.label || key, required: param.required },
              param.type === "select"
                ? React.createElement(Select, { value: params[key], onChange: v => setParams(p => ({ ...p, [key]: v })) },
                    (param.options || []).map(o => React.createElement(Select.Option, { key: o, value: o }, o))
                  )
                : param.type === "password"
                  ? React.createElement(Input.Password, { value: params[key], onChange: e => setParams(p => ({ ...p, [key]: e.target.value })) })
                  : param.type === "textarea"
                    ? React.createElement(TextArea, { value: params[key], rows: 3, onChange: e => setParams(p => ({ ...p, [key]: e.target.value })) })
                    : React.createElement(Input, { value: params[key], onChange: e => setParams(p => ({ ...p, [key]: e.target.value })) })
            )
          )
        )
      : React.createElement(Paragraph, null, "此脚本无需参数，点击\"运行\"开始执行。")
  );
}

// ── Scheme Runner Modal ───────────────────────────────────────────────────

function SchemeRunner({ scheme, scripts, visible, onClose, onRun }) {
  const [stepParams, setStepParams] = useState({});

  useEffect(() => {
    if (!scheme) return;
    const next = {};
    scheme.steps.forEach((step, index) => {
      const sid = typeof step === "string" ? step : step.script_id;
      const sc = scripts.find(s => s.id === sid);
      const defaults = {};
      Object.entries(sc?.params || {}).forEach(([k, v]) => { defaults[k] = getParamDefault(v); });
      const savedStepParams = typeof step === "object" && step ? (step.params || {}) : {};
      next[index] = { ...defaults, ...savedStepParams };
    });
    setStepParams(next);
  }, [scheme, scripts]);

  if (!scheme) return null;

  const stepMeta = scheme.steps.map((step, index) => {
    const sid = typeof step === "string" ? step : step.script_id;
    const sc = scripts.find(s => s.id === sid);
    return { index, step, scriptId: sid, script: sc };
  });
  const totalParamCount = stepMeta.reduce((sum, item) => sum + Object.keys(item.script?.params || {}).length, 0);

  const updateStepParam = (index, key, value) => {
    setStepParams(prev => ({
      ...prev,
      [index]: { ...(prev[index] || {}), [key]: value }
    }));
  };

  return React.createElement(Modal, {
    title: `运行方案: ${scheme.name}`, visible, onCancel: onClose, width: 680,
    footer: [
      React.createElement(Button, { key: "cancel", onClick: onClose }, "取消"),
      React.createElement(Button, { key: "run", type: "primary", onClick: () => onRun(scheme.id, {}, stepParams) }, "运行方案")
    ]
  },
    React.createElement(Paragraph, null,
      "将按顺序执行 ", React.createElement(Text, { strong: true }, scheme.steps.length), " 个脚本。每个脚本会先载入当前保存的最新参数值，可修改后运行，也可不修改直接运行。"
    ),
    React.createElement("div", null,
      stepMeta.map(({ index, scriptId, script }) =>
        React.createElement(Tag, { key: `tag-${index}`, style: { margin: "2px 4px 2px 0" } }, `${index + 1}. ${script?.name || scriptId}`)
      )
    ),
    totalParamCount > 0
      ? React.createElement("div", null,
          stepMeta.map(({ index, scriptId, script }) => {
            const entries = Object.entries(script?.params || {});
            if (entries.length === 0) return null;
            const paramsForStep = stepParams[index] || {};
            return React.createElement(Card, { key: index, size: "small", title: `${index + 1}. ${script?.name || scriptId}`, style: { marginTop: 12 } },
              React.createElement(Form, { layout: "vertical" },
                entries.map(([key, param]) =>
                  React.createElement(Form.Item, { key, label: param.label || key, required: param.required },
                    param.type === "select"
                      ? React.createElement(Select, { value: paramsForStep[key], onChange: v => updateStepParam(index, key, v) },
                          (param.options || []).map(o => React.createElement(Select.Option, { key: o, value: o }, o))
                        )
                      : param.type === "password"
                        ? React.createElement(Input.Password, { value: paramsForStep[key], onChange: e => updateStepParam(index, key, e.target.value) })
                        : param.type === "textarea"
                          ? React.createElement(TextArea, { value: paramsForStep[key], rows: 3, onChange: e => updateStepParam(index, key, e.target.value) })
                          : React.createElement(Input, { value: paramsForStep[key], onChange: e => updateStepParam(index, key, e.target.value) })
                  )
                )
              )
            );
          })
        )
      : React.createElement(Paragraph, null, "当前方案中的脚本均无需参数，点击\"运行方案\"开始执行。")
  );
}

// ── Script Editor Modal ───────────────────────────────────────────────────

function ScriptEditor({ script, visible, onClose, onSave }) {
  const [form] = Form.useForm();
  const [code, setCode] = useState("");
  const [paramsJson, setParamsJson] = useState("");

  useEffect(() => {
    if (visible) {
      if (script) {
        form.setFieldsValue({ id: script.id, name: script.name, type: script.type, description: script.description });
        setCode(script.code || "");
        setParamsJson(JSON.stringify(script.params || {}, null, 2));
      } else {
        form.resetFields();
        setCode("");
        setParamsJson("");
      }
    }
  }, [script, visible]);

  const handleOk = () => {
    form.validateFields().then(values => {
      let parsedParams = {};
      try { parsedParams = JSON.parse(paramsJson || "{}"); } catch (e) { message.error("参数 JSON 格式错误"); return; }
      onSave({ ...values, code, params: parsedParams, readonly: false });
    });
  };

  return React.createElement(Modal, {
    title: script ? `编辑: ${script.name}` : "新建脚本", visible, onCancel: onClose, onOk: handleOk, width: 700
  },
    React.createElement(Form, { form, layout: "vertical" },
      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, { name: "id", label: "ID", rules: [{ required: true }] },
            React.createElement(Input, { disabled: !!script })
          )
        ),
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, { name: "name", label: "名称", rules: [{ required: true }] },
            React.createElement(Input, null)
          )
        ),
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, { name: "type", label: "类型", rules: [{ required: true }] },
            React.createElement(Select, null,
              React.createElement(Select.Option, { value: "shell" }, "Shell"),
              React.createElement(Select.Option, { value: "python" }, "Python")
            )
          )
        )
      ),
      React.createElement(Form.Item, { name: "description", label: "描述" },
        React.createElement(Input.TextArea, { rows: 2 })
      ),
      React.createElement(Form.Item, { label: "代码", required: true },
        React.createElement(TextArea, { value: code, onChange: e => setCode(e.target.value), rows: 10, style: { fontFamily: "monospace" } })
      ),
      React.createElement(Form.Item, { label: React.createElement("span", null, "参数定义 (JSON)", React.createElement("span", { style: { color: "#bbb", fontSize: 11, marginLeft: 8, fontWeight: "normal", fontFamily: "monospace" } }, `{"VAR1": {"type": "string、textarea、select、password", "label": "...", "required": true/false, "default": "", "options": []}}`) ) },
        React.createElement(TextArea, { value: paramsJson, onChange: e => setParamsJson(e.target.value), rows: 3, placeholder: '{"VAR1": {"type": "string、textarea、select、password", "label": "...", "required": true/false, "default": "", "options": []}, "VAR2": {"type": "string、textarea、select、password", "label": "...", "required": true/false, "default": "", "options": []}}' })
      )
    )
  );
}

// ── Scheme Editor Modal ───────────────────────────────────────────────────

function SchemeEditor({ scheme, scripts, visible, onClose, onSave }) {
  const [form] = Form.useForm();
  const [selectedSteps, setSelectedSteps] = useState([]);

  useEffect(() => {
    if (visible) {
      if (scheme) {
        form.setFieldsValue({ id: scheme.id, name: scheme.name, description: scheme.description });
        setSelectedSteps(scheme.steps.map(s => typeof s === "string" ? s : s.script_id));
      } else {
        form.resetFields();
        setSelectedSteps([]);
      }
    }
  }, [scheme, visible]);

  const handleOk = () => {
    form.validateFields().then(values => {
      onSave({ ...values, steps: selectedSteps });
    });
  };

  return React.createElement(Modal, {
    title: scheme ? `编辑: ${scheme.name}` : "新建方案", visible, onCancel: onClose, onOk: handleOk, width: 600
  },
    React.createElement(Form, { form, layout: "vertical" },
      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, { name: "id", label: "ID", rules: [{ required: true }] },
            React.createElement(Input, { disabled: !!scheme })
          )
        ),
        React.createElement(Col, { span: 16 },
          React.createElement(Form.Item, { name: "name", label: "名称", rules: [{ required: true }] },
            React.createElement(Input, null)
          )
        )
      ),
      React.createElement(Form.Item, { name: "description", label: "描述" },
        React.createElement(Input.TextArea, { rows: 2 })
      ),
      React.createElement(Form.Item, { label: "步骤（按顺序执行）" },
        React.createElement(Select, {
          mode: "multiple", value: selectedSteps, onChange: setSelectedSteps, style: { width: "100%" }, placeholder: "选择要执行的脚本..."
        },
          scripts.filter(s => !s.readonly || true).map(s =>
            React.createElement(Select.Option, { key: s.id, value: s.id },
              s.name, s.readonly && React.createElement(Tag, null, "内置")
            )
          )
        )
      )
    )
  );
}

// ── Script Edit + Run Modal ─────────────────────────────────────────────

function ScriptEditRunModal({ script, visible, onClose, onSave, onSaveAs, onRun }) {
  const [code, setCode] = useState("");
  const [params, setParams] = useState({});
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!script) return;
    console.log("[EnvConfig] EditRunModal opened with script:", { id: script.id, paramsKeys: Object.keys(script.params || {}), params: script.params });
    setCode(script.code || "");
    const defaults = {};
    Object.entries(script.params || {}).forEach(([k, v]) => { defaults[k] = getParamDefault(v); });
    setParams(defaults);
    setShowSaveAs(false);
    setNewId("");
    setNewName("");
  }, [script]);

  if (!script) return null;

  const handleSave = () => {
    // Merge runtime param values into param definitions as new defaults
    const mergedParams = {};
    Object.entries(script.params || {}).forEach(([key, paramDef]) => {
      const val = params[key];
      mergedParams[key] = {
        ...paramDef,
        default: (val !== undefined && val !== null && val !== '')
          ? val
          : paramDef.default
      };
    });
    const data = { ...script, params: mergedParams, code, readonly: false };
    console.log("[EnvConfig] handleSave data:", JSON.stringify({ id: data.id, paramsKeys: Object.keys(data.params || {}), params: data.params }));
    console.log("[EnvConfig] handleSave CODE PREVIEW:", JSON.stringify(data.code?.substring(0, 80)));
    onSave(data);
  };

  const handleSaveAs = () => {
    if (!newId.trim() || !newName.trim()) {
      message.error("请输入新脚本 ID 和名称");
      return;
    }
    onSaveAs({
      ...script,
      id: newId.trim(),
      name: newName.trim(),
      code,
      readonly: false
    });
    setShowSaveAs(false);
    setNewId("");
    setNewName("");
  };

  return React.createElement(Modal, {
    title: `编辑: ${script.name}`,
    visible, onCancel: onClose, width: 800,
    footer: [
      React.createElement(Button, { key: "cancel", onClick: onClose }, "取消"),
      !showSaveAs && React.createElement(Button, { key: "saveas", onClick: () => setShowSaveAs(true) }, "另存为"),
      showSaveAs && React.createElement(Button, { key: "saveas-confirm", type: "default", onClick: handleSaveAs }, "确认另存为"),
      React.createElement(Button, { key: "save", icon: "💾", onClick: handleSave }, "保存"),
      React.createElement(Button, { key: "run", type: "primary", icon: "▶️", onClick: () => onRun(script.id, params, code) }, "运行")
    ]
  },
    React.createElement(Form, { layout: "vertical" },
      showSaveAs && React.createElement("div", { style: { background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, padding: "12px 16px", marginBottom: 12 } },
        React.createElement(Row, { gutter: 12 },
          React.createElement(Col, { span: 12 },
            React.createElement(Form.Item, { label: "新脚本 ID", required: true, style: { marginBottom: 0 } },
              React.createElement(Input, {
                value: newId,
                onChange: e => setNewId(e.target.value),
                placeholder: "输入唯一标识"
              })
            )
          ),
          React.createElement(Col, { span: 12 },
            React.createElement(Form.Item, { label: "新脚本名称", required: true, style: { marginBottom: 0 } },
              React.createElement(Input, {
                value: newName,
                onChange: e => setNewName(e.target.value),
                placeholder: "输入显示名称"
              })
            )
          )
        )
      ),
      React.createElement(Form.Item, { label: "脚本代码（可编辑）" },
        React.createElement(TextArea, {
          value: code,
          onChange: e => setCode(e.target.value),
          rows: 14,
          style: { fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace", fontSize: 12 }
        })
      ),
      Object.keys(script.params || {}).length > 0 && [
        React.createElement(Divider, { key: "divider" }),
        React.createElement("div", { key: "params-title", style: { marginBottom: 8, fontSize: 13, fontWeight: 500, color: "#333" } }, "参数"),
        ...Object.entries(script.params).map(([key, param]) =>
          React.createElement("div", { key, style: { marginBottom: 8 } },
            React.createElement("label", { style: { display: "block", marginBottom: 4, fontSize: 12, color: "#666" } },
              param.label || key, param.required && React.createElement("span", { style: { color: "red" } }, " *")
            ),
            param.type === "select"
              ? React.createElement(Select, { value: params[key], onChange: v => setParams(p => ({ ...p, [key]: v })) },
                  (param.options || []).map(o => React.createElement(Select.Option, { key: o, value: o }, o))
                )
              : param.type === "password"
                ? React.createElement(Input.Password, { value: params[key], onChange: e => setParams(p => ({ ...p, [key]: e.target.value })) })
                : param.type === "textarea"
                  ? React.createElement(TextArea, { value: params[key], rows: 3, onChange: e => setParams(p => ({ ...p, [key]: e.target.value })) })
                  : React.createElement(Input, { value: params[key], onChange: e => setParams(p => ({ ...p, [key]: e.target.value })) })
          )
        )
      ]
    )
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

function EnvConfigPage() {
  const [scripts, setScripts] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [execLogs, setExecLogs] = useState([]);
  const [runningScriptId, setRunningScriptId] = useState(null);
  const [runScript, setRunScript] = useState(null);
  const [runScheme, setRunScheme] = useState(null);
  const [editScript, setEditScript] = useState(null);
  const [editScheme, setEditScheme] = useState(null);
  const [editRunScript, setEditRunScript] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showSchemeEditor, setShowSchemeEditor] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sc, sh] = await Promise.all([api("/scripts"), api("/schemes")]);
      console.log("[EnvConfig] loadData scripts:", (sc || []).map(s => ({ id: s.id, paramsKeys: Object.keys(s.params || {}) })));
      setScripts(sc || []);
      setSchemes(sh || []);
    } catch (e) { message.error("加载失败: " + e.message); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const executeScript = async (scriptId, params, codeOverride) => {
    setRunScript(null);
    setEditRunScript(null);
    setExecLogs([]);
    setRunningScriptId(scriptId);
    const url = getApiUrl("/env-config/execute");
    const fullUrl = tk() ? `${url}?token=${encodeURIComponent(tk())}` : url;

    try {
      const resp = await fetch(fullUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script_id: scriptId, params, ...(codeOverride != null ? { code: codeOverride } : {}) }),
      });
      if (!resp.ok) throw new Error(await resp.text() || resp.statusText);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done || data.type === "complete") {
                setRunningScriptId(null);
                return;
              }
              setExecLogs(prev => [...prev, data]);
            } catch (e) { /* ignore malformed SSE lines */ }
          }
        }
      }
      setRunningScriptId(null);
    } catch (e) {
      message.error("执行失败: " + e.message);
      setRunningScriptId(null);
    }
  };

  const executeScheme = async (schemeId, params, stepParams = {}) => {
    setRunScheme(null);
    setExecLogs([]);
    setRunningScriptId('scheme:' + schemeId);
    const url = getApiUrl("/env-config/execute");
    const fullUrl = tk() ? `${url}?token=${encodeURIComponent(tk())}` : url;

    try {
      const resp = await fetch(fullUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheme_id: schemeId, params, step_params: stepParams }),
      });
      if (!resp.ok) throw new Error(await resp.text() || resp.statusText);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done || data.type === "complete") {
                setRunningScriptId(null);
                return;
              }
              setExecLogs(prev => [...prev, data]);
            } catch (e) { /* ignore */ }
          }
        }
      }
      setRunningScriptId(null);
    } catch (e) {
      message.error("执行失败: " + e.message);
      setRunningScriptId(null);
    }
  };

  const saveScript = async (data) => {
    try {
      await api("/scripts", { method: "POST", body: JSON.stringify(data) });
      message.success("脚本已保存");
      setShowEditor(false);
      setEditScript(null);
      loadData();
    } catch (e) { message.error("保存失败: " + e.message); }
  };

  const saveEditedScript = async (data) => {
    try {
      console.log("[EnvConfig] saveEditedScript sending:", { id: data.id, paramsKeys: Object.keys(data.params || {}), codeLen: (data.code || '').length, codePreview: (data.code || '').substring(0, 80) });
      const resp = await api("/scripts", { method: "POST", body: JSON.stringify(data) });
      console.log("[EnvConfig] saveEditedScript response:", resp);
      message.success("脚本已保存（覆盖内置版本）");
      setEditRunScript(null);
      await loadData();
    } catch (e) { message.error("保存失败: " + e.message); }
  };

  const saveEditedScriptAs = async (data) => {
    try {
      console.log("[EnvConfig] saveEditedScriptAs sending:", { id: data.id, name: data.name, paramsKeys: Object.keys(data.params || {}) });
      await api("/scripts", { method: "POST", body: JSON.stringify(data) });
      message.success(`已另存为新脚本: ${data.name}`);
      setEditRunScript(null);
      await loadData();
    } catch (e) { message.error("另存为失败: " + e.message); }
  };

  const deleteScript = async (id) => {
    try {
      await api(`/scripts/${id}`, { method: "DELETE" });
      message.success("已删除");
      loadData();
    } catch (e) { message.error("删除失败: " + e.message); }
  };

  const saveScheme = async (data) => {
    try {
      const steps = data.steps.map(s => ({ script_id: s }));
      await api("/schemes", { method: "POST", body: JSON.stringify({ ...data, steps }) });
      message.success("方案已保存");
      setShowSchemeEditor(false);
      setEditScheme(null);
      loadData();
    } catch (e) { message.error("保存失败: " + e.message); }
  };

  const deleteScheme = async (id) => {
    try {
      await api(`/schemes/${id}`, { method: "DELETE" });
      message.success("已删除");
      loadData();
    } catch (e) { message.error("删除失败: " + e.message); }
  };

  const scriptColumns = [
    { title: "名称", dataIndex: "name", key: "name", render: (n, r) => React.createElement(Text, { strong: true }, n, r.readonly && React.createElement(Tag, { color: "blue" }, "内置")) },
    { title: "类型", dataIndex: "type", key: "type", width: 80 },
    { title: "描述", dataIndex: "description", key: "description", ellipsis: true },
    { title: "标签", dataIndex: "tags", key: "tags", width: 200, render: (tags) => (tags || []).map(t => React.createElement(Tag, { key: t }, t)) },
    {
      title: "操作", key: "action", width: 220,
      render: (_, record) => React.createElement(Space, null,
        React.createElement(Button, { size: "small", type: "primary", onClick: () => setRunScript(record), loading: runningScriptId === record.id }, "运行"),
        React.createElement(Button, { size: "small", onClick: () => setEditRunScript(record) }, "编辑"),
        !record.readonly && React.createElement(Popconfirm, { title: "确定删除？", onConfirm: () => deleteScript(record.id) },
          React.createElement(Button, { size: "small", danger: true }, "删除")
        )
      )
    }
  ];

  const schemeColumns = [
    { title: "名称", dataIndex: "name", key: "name", render: (n) => React.createElement(Text, { strong: true }, n) },
    { title: "描述", dataIndex: "description", key: "description", ellipsis: true },
    { title: "步骤数", key: "steps", width: 80, render: (_, r) => React.createElement(Tag, null, r.steps?.length || 0) },
    {
      title: "步骤", key: "steps_detail", ellipsis: true,
      render: (_, r) => (r.steps || []).map(s => {
        const sid = typeof s === "string" ? s : s.script_id;
        const sc = scripts.find(x => x.id === sid);
        return React.createElement(Tag, { key: sid, style: { margin: "1px" } }, sc?.name || sid);
      })
    },
    {
      title: "操作", key: "action", width: 220,
      render: (_, record) => React.createElement(Space, null,
        React.createElement(Button, { size: "small", type: "primary", onClick: () => setRunScheme(record), loading: runningScriptId === 'scheme:' + record.id, disabled: !record.steps?.length }, "运行方案"),
        React.createElement(Button, { size: "small", onClick: () => { setEditScheme(record); setShowSchemeEditor(true); } }, "编辑"),
        React.createElement(Popconfirm, { title: "确定删除？", onConfirm: () => deleteScheme(record.id) },
          React.createElement(Button, { size: "small", danger: true }, "删除")
        )
      )
    }
  ];

  return React.createElement("div", { style: { padding: 16 } },
    React.createElement(Title, { level: 4, style: { marginBottom: 8 } },
      "⚙️ 环境配置",
      React.createElement("span", { style: { fontSize: 13, fontWeight: "normal", marginLeft: 12, color: "#888" } },
        "管理并一键执行环境配置脚本"
      )
    ),
    React.createElement(Tabs, { defaultActiveKey: "scripts" },
      React.createElement(Tabs.TabPane, { tab: "📜 配置脚本", key: "scripts" },
        React.createElement(Card, { size: "small", extra: React.createElement(Button, { type: "primary", size: "small", onClick: () => { setEditScript(null); setShowEditor(true); } }, "新建脚本") },
          React.createElement(Table, {
            dataSource: scripts, columns: scriptColumns, rowKey: "id",
            loading: loading, size: "small", pagination: false
          })
        )
      ),
      React.createElement(Tabs.TabPane, { tab: "📋 配置方案", key: "schemes" },
        React.createElement(Card, { size: "small", extra: React.createElement(Button, { type: "primary", size: "small", onClick: () => { setEditScheme(null); setShowSchemeEditor(true); } }, "新建方案") },
          React.createElement(Table, {
            dataSource: schemes, columns: schemeColumns, rowKey: "id",
            loading: loading, size: "small", pagination: false
          })
        )
      )
    ),
    React.createElement(Divider, { style: { margin: "12px 0" } }),
    React.createElement(ExecutionPanel, { logs: execLogs, onClose: () => setExecLogs([]) }),
    React.createElement(ScriptRunner, { script: runScript, visible: !!runScript, onClose: () => setRunScript(null), onRun: executeScript }),
    React.createElement(ScriptEditRunModal, { script: editRunScript, visible: !!editRunScript, onClose: () => setEditRunScript(null), onSave: saveEditedScript, onSaveAs: saveEditedScriptAs, onRun: executeScript }),
    React.createElement(SchemeRunner, { scheme: runScheme, scripts, visible: !!runScheme, onClose: () => setRunScheme(null), onRun: executeScheme }),
    React.createElement(ScriptEditor, { script: editScript, visible: showEditor, onClose: () => { setShowEditor(false); setEditScript(null); }, onSave: saveScript }),
    React.createElement(SchemeEditor, { scheme: editScheme, scripts, visible: showSchemeEditor, onClose: () => { setShowSchemeEditor(false); setEditScheme(null); }, onSave: saveScheme })
  );
}

// ── Register plugin ───────────────────────────────────────────────────────

class EnvConfigPlugin {
  constructor() { this.id = PLUGIN_ID; }
  setup() {
    window.QwenPaw.registerRoutes?.(this.id, [{
      path: "/plugin/env-config/scripts",
      component: EnvConfigPage,
      label: "环境配置",
      icon: "⚙️",
      priority: 100,
    }]);
    console.info("[env-config] Plugin v1.0 loaded");
  }
}

new EnvConfigPlugin().setup();
