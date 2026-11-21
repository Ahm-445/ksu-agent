import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// React 19 only suppresses its "not wrapped in act" warning when the test environment
// says it is one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements neither, and the message list scrolls itself into view.
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});
