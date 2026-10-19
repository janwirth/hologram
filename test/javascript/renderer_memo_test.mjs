"use strict";

import {
  assert,
  componentRegistryEntryFixture,
  defineRuntimeGlobals,
  initComponentRegistryEntry,
} from "./support/helpers.mjs";

import ComponentRegistry from "../../assets/js/component_registry.mjs";
import Interpreter from "../../assets/js/interpreter.mjs";
import Renderer from "../../assets/js/renderer.mjs";
import Type from "../../assets/js/type.mjs";
import Vdom from "../../assets/js/vdom.mjs";

defineRuntimeGlobals();

const PREFIX = "Hologram.Test.Fixtures.RendererMemo";

// Template evaluations per module, counted by the templates below.
const evaluations = {};

function defineFunction(module, name, body) {
  Interpreter.defineElixirFunction(`${PREFIX}.${module}`, name, 0, "public", [
    { params: (_context) => [], guards: [], body },
  ]);
}

// Defines a component (or page) whose template is `render(vars)`, a JS function from the vars map
// to a list of DOM nodes.
function defineModule(module, { props = [], layout = null, render }) {
  evaluations[module] = 0;

  defineFunction(module, "__props__", () =>
    Type.list(
      props.map((name) =>
        Type.tuple([Type.atom(name), Type.atom("any"), Type.list()]),
      ),
    ),
  );

  if (layout !== null) {
    defineFunction(module, "__layout_module__", () =>
      Type.atom(`Elixir.${PREFIX}.${layout}`),
    );

    defineFunction(module, "__layout_props__", () => Type.list());
    defineFunction(module, "__params__", () => Type.list());
  }

  defineFunction(module, "template", (context) =>
    Type.anonymousFunction(
      1,
      [
        {
          params: (_context) => [Type.variablePattern("vars")],
          guards: [],
          body: (context) => {
            evaluations[module] += 1;
            return Type.list(render(context.vars.vars));
          },
        },
      ],
      context,
    ),
  );
}

const alias = (module) => Type.alias(`${PREFIX}.${module}`);
const get = (vars, key) => Erlang_Maps["get/2"](Type.atom(key), vars);
const text = (value) => Type.tuple([Type.atom("text"), Type.bitstring(value)]);
const expression = (value) =>
  Type.tuple([Type.atom("expression"), Type.tuple([value])]);

const element = (tag, attrs, children) =>
  Type.tuple([
    Type.atom("element"),
    Type.bitstring(tag),
    Type.list(attrs),
    Type.list(children),
  ]);

const attr = (name, value) =>
  Type.tuple([Type.bitstring(name), Type.keywordList([value])]);

const actionAttr = (name) =>
  Type.tuple([Type.bitstring(name), Type.list([text("my_action")])]);

const component = (module, props, children = []) =>
  Type.tuple([
    Type.atom("component"),
    alias(module),
    Type.list(
      Object.entries(props).map(([name, value]) =>
        attr(name, [Type.atom("expression"), Type.tuple([value])]),
      ),
    ),
    Type.list(children),
  ]);

const slot = () => element("slot", [], []);

defineModule("Layout", {
  render: () => [
    element(
      "html",
      [],
      [element("head", [], []), element("body", [], [slot()])],
    ),
  ],
});

const bodyOf = (page) => page.children.find((child) => child.sel === "body");

defineModule("Card", {
  props: ["title"],
  render: (vars) => [
    element(
      "div",
      [actionAttr("$click_outside"), actionAttr("$reach_bottom")],
      [element("p", [actionAttr("$resize")], [expression(get(vars, "title"))])],
    ),
  ],
});

defineModule("Panel", {
  props: ["open"],
  render: (vars) => [
    element(
      "aside",
      [],
      [text(Type.isTrue(get(vars, "open")) ? "open" : "closed")],
    ),
    element("window", [actionAttr("$key_down")], []),
  ],
});

defineModule("Frame", {
  render: () => [element("section", [], [slot()])],
});

defineModule("Counter", {
  props: ["cid"],
  render: (vars) => [element("span", [], [expression(get(vars, "count"))])],
});

// A stateless wrapper around the stateful counter, so the counter sits inside a parent whose own
// inputs never change.
defineModule("Box", {
  render: () => [component("Counter", { cid: Type.bitstring("counter") })],
});

defineModule("Keyed", {
  render: () => [
    element("b", [attr("$key", [Type.atom("text"), Type.bitstring("k")])], []),
  ],
});

defineModule("Page", {
  layout: "Layout",
  render: (vars) => [
    ...get(vars, "cards").data.map((title) => component("Card", { title })),
    component("Panel", { open: get(vars, "open") }),
    component("Frame", {}, [expression(get(vars, "note"))]),
    component("Box", {}),
    component("Keyed", {}),
    component("Keyed", {}),
  ],
});

const titles = Array.from({ length: 50 }, (_, index) => `card ${index}`);

function putPageState({ open = false, note = "a", cards = titles } = {}) {
  ComponentRegistry.putEntry(
    Type.bitstring("page"),
    componentRegistryEntryFixture({
      module: alias("Page"),
      state: Type.map([
        [Type.atom("cards"), Type.list(cards.map((t) => Type.bitstring(t)))],
        [Type.atom("open"), Type.boolean(open)],
        [Type.atom("note"), Type.bitstring(note)],
      ]),
    }),
  );
}

function putCounter(count) {
  ComponentRegistry.putEntry(
    Type.bitstring("counter"),
    componentRegistryEntryFixture({
      module: alias("Counter"),
      state: Type.map([[Type.atom("count"), Type.integer(count)]]),
    }),
  );
}

const render = () => Renderer.renderPage(alias("Page"), Type.map());

const resetCounts = () => {
  for (const module in evaluations) evaluations[module] = 0;
};

// The rendered HTML as Snabbdom would build it, for comparing a reused render against a fresh one.
function html(vnode) {
  if (vnode.sel === undefined) return vnode.text;

  const attrs = Object.entries(vnode.data?.attrs ?? {})
    .map(([key, value]) => ` ${key}="${value}"`)
    .join("");

  return `<${vnode.sel}${attrs}>${(vnode.children ?? []).map(html).join("")}</${vnode.sel}>`;
}

function freshHtml() {
  Renderer.memoize = false;

  try {
    return html(render());
  } finally {
    Renderer.memoize = true;
  }
}

describe("Renderer memo", () => {
  beforeEach(() => {
    ComponentRegistry.clear();
    Renderer.clearMemo();
    initComponentRegistryEntry(Type.bitstring("layout"), alias("Layout"));
    putPageState();
    putCounter(1);
    render();
    resetCounts();
  });

  it("evaluates only the panel when only the panel's prop changes", () => {
    putPageState({ open: true });
    const result = render();

    assert.equal(evaluations.Page, 1);
    assert.equal(evaluations.Panel, 1);
    assert.equal(evaluations.Card, 0);
    assert.equal(evaluations.Frame, 0);
    assert.equal(evaluations.Counter, 0);
    assert.equal(html(result), freshHtml());
    assert.include(html(result), "<aside>open</aside>");
  });

  it("evaluates no template when the page state is unchanged", () => {
    putPageState();
    const result = render();

    for (const module in evaluations) {
      assert.equal(evaluations[module], 0, module);
    }

    assert.equal(html(result), freshHtml());
  });

  it("re-renders a stateful component inside an unchanged parent when its state changes", () => {
    putCounter(2);
    const result = render();

    assert.equal(evaluations.Counter, 1);
    assert.equal(evaluations.Box, 1);
    assert.equal(evaluations.Card, 0);
    assert.include(html(result), "<span>2</span>");
  });

  it("re-renders a component whose slot content changed", () => {
    putPageState({ note: "b" });
    const result = render();

    assert.equal(evaluations.Frame, 1);
    assert.equal(evaluations.Card, 0);
    assert.include(html(result), "<section>b</section>");
  });

  it("re-renders a card whose prop changed and no other", () => {
    putPageState({ cards: titles.map((t, i) => (i === 7 ? "changed" : t)) });
    const result = render();

    assert.equal(evaluations.Card, 1);
    assert.equal(html(result), freshHtml());
  });

  it("numbers repeated keys in reused output the way a fresh render does", () => {
    const keys = (page) =>
      bodyOf(page)
        .children.filter((child) => child.sel === "b")
        .map((child) => [child.key, child.data.key]);

    const reused = keys(render());
    assert.equal(evaluations.Keyed, 0);

    Renderer.memoize = false;
    const fresh = keys(render());
    Renderer.memoize = true;

    assert.deepEqual(reused, fresh);
    assert.equal(fresh[1][0], `${fresh[0][0]}:1`);
  });

  it("starts from an empty cache after clearMemo", () => {
    Renderer.clearMemo();
    render();

    assert.equal(evaluations.Card, 50);
  });

  it("returns new vnodes on a reuse, never the ones an earlier render returned", () => {
    const first = render();
    const second = render();

    const firstBody = bodyOf(first);
    const secondBody = bodyOf(second);

    secondBody.children.forEach((child, index) => {
      assert.notStrictEqual(child, firstBody.children[index]);
    });
  });

  it("collects every binding of a reused subtree again, for the vnodes this render returns", () => {
    const expected = {
      listener: Renderer.listenerBindings.length,
      reach: Renderer.reachBindings.length,
      resize: Renderer.resizeBindings.length,
    };

    // 50 click_outside + the panel's window binding; one reach and one resize per card.
    assert.deepEqual(expected, { listener: 51, reach: 50, resize: 50 });

    for (let i = 0; i < 5; i++) {
      putPageState({ open: i % 2 === 0 });
      const result = render();

      assert.deepEqual(
        {
          listener: Renderer.listenerBindings.length,
          reach: Renderer.reachBindings.length,
          resize: Renderer.resizeBindings.length,
        },
        expected,
      );

      const body = bodyOf(result);
      const cards = body.children.filter((child) => child.sel === "div");

      cards.forEach((card, index) => {
        assert.strictEqual(Renderer.reachBindings[index].vnode, card);
        assert.strictEqual(
          Renderer.resizeBindings[index].vnode,
          card.children[0],
        );
      });
    }

    assert.equal(evaluations.Card, 0);
  });

  it("binds the reused vnodes to the live DOM after a patch", () => {
    document.body.innerHTML = "";

    let virtualDocument = Vdom.mirror(render(), document.documentElement);
    virtualDocument = Vdom.patchVirtualDocument(virtualDocument, render());

    for (let i = 0; i < 3; i++) {
      putPageState({ open: i % 2 === 0 });
      virtualDocument = Vdom.patchVirtualDocument(virtualDocument, render());

      const divs = document.body.querySelectorAll("div");
      assert.equal(divs.length, 50);

      Renderer.reachBindings.forEach((binding, index) => {
        assert.strictEqual(binding.vnode.elm, divs[index]);
      });
    }

    assert.equal(document.body.querySelector("aside").textContent, "open");
  });
});
