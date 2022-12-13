import type {ChangeEvent} from 'react';
import type {
  VirtualElement,
  VirtualElementComponent,
  VirtualElementTag,
  VirtualElementParent,
  VirtualElementChildren,
  VirtualElementReal,
  VirtualElementFragment,
} from './teact';
import {
  hasElementChanged,
  isComponentElement,
  isTagElement,
  isParentElement,
  isTextElement,
  isEmptyElement,
  mountComponent,
  renderComponent,
  unmountComponent,
  isFragmentElement,
} from './teact';
import {DEBUG} from '../config';
import {addEventListener, removeAllDelegatedListeners, removeEventListener} from './dom-events';
import {unique} from '../util/iteratees';
import {ChainOfRenderVirtual} from "../util/virtual/helper";
import {VirtualChainOptions} from "../util/virtual/interface";

type VirtualDomHead = {
  children: [VirtualElement] | [];
};

const FILTERED_ATTRIBUTES = new Set(['key', 'ref', 'teactFastList', 'teactOrderKey']);
const HTML_ATTRIBUTES = new Set(['dir', 'role', 'form']);
const CONTROLLABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];
const MAPPED_ATTRIBUTES: { [k: string]: string } = {
  autoPlay: 'autoplay',
  autoComplete: 'autocomplete',
};
const INDEX_KEY_PREFIX = '__indexKey#';

const headsByElement = new WeakMap<HTMLElement, VirtualDomHead>();

function render($element: VirtualElement | undefined, parentEl: HTMLElement) {
  if (!headsByElement.has(parentEl)) {
    headsByElement.set(parentEl, {children: []});
  }

  const $head = headsByElement.get(parentEl)!;
  const $newElement = renderWithVirtual(parentEl, $head.children[0], $element, $head, 0);
  console.log("Render " , $newElement)
  $head.children = $newElement ? [$newElement] : [];

  return undefined;
}

function renderWithVirtual<T extends VirtualElement | undefined>(
  parentEl: HTMLElement,
  $current: VirtualElement | undefined,
  $new: T,
  $parent: VirtualElementParent | VirtualDomHead,
  index: number,
  options: {
    skipComponentUpdate?: boolean;
    nextSibling?: ChildNode;
    fragment?: DocumentFragment;
  } = {},
): T {
  const renderVirtualResult = new ChainOfRenderVirtual().render({
      parentEl,
      $current,
      $new,
      $parent,
      index,
      options,
    } as VirtualChainOptions<T>);

  return renderVirtualResult.$new as T;
}

export function initComponent(
  parentEl: HTMLElement,
  $element: VirtualElementComponent,
  $parent: VirtualElementParent | VirtualDomHead,
  index: number,
) {
  console.log('Init Component ' , {
    parentEl,
    $element,
    $parent,
    index,
  })
  const {componentInstance} = $element;

  if (!componentInstance.isMounted) {
    $element = mountComponent(componentInstance);
    setupComponentUpdateListener(parentEl, $element, $parent, index);

    const $firstChild = $element.children[0];
    if (isComponentElement($firstChild)) {
      $element.children = [initComponent(parentEl, $firstChild, $element, 0)];
    }

    componentInstance.isMounted = true;
  }

  return $element;
}

export function updateComponent($current: VirtualElementComponent, $new: VirtualElementComponent) {
  $current.componentInstance.props = $new.componentInstance.props;

  return renderComponent($current.componentInstance);
}

export function setupComponentUpdateListener(
  parentEl: HTMLElement,
  $element: VirtualElementComponent,
  $parent: VirtualElementParent | VirtualDomHead,
  index: number,
) {
  const {componentInstance} = $element;

  componentInstance.onUpdate = () => {
    $parent.children[index] = renderWithVirtual(
      parentEl,
      $parent.children[index],
      componentInstance.$element,
      $parent,
      index,
      {skipComponentUpdate: true},
    );
  };
}

export function mountChildren(
  parentEl: HTMLElement,
  $element: VirtualElementComponent | VirtualElementFragment,
  options: {
    nextSibling?: ChildNode;
    fragment?: DocumentFragment;
  },
) {
  $element.children = $element.children.map(($child, i) => {
    return renderWithVirtual(parentEl, undefined, $child, $element, i, options);
  });
}

function unmountChildren(parentEl: HTMLElement, $element: VirtualElementComponent | VirtualElementFragment) {
  $element.children.forEach(($child) => {
    renderWithVirtual(parentEl, $child, undefined, $element, -1);
  });
}

export function createNode($element: VirtualElementReal): Node {
  console.log('Create Node ' , $element)
  if (isEmptyElement($element)) {
    return document.createTextNode('');
  }

  if (isTextElement($element)) {
    return document.createTextNode($element.value);
  }

  const {tag, props, children = []} = $element;
  const element = document.createElement(tag);

  if (typeof props.ref === 'object') {
    props.ref.current = element;
  } else if (typeof props.ref === 'function') {
    props.ref(element);
  }

  processControlled(tag, props);

  Object.entries(props).forEach(([key, value]) => {
    if (props[key] !== undefined) {
      setAttribute(element, key, value);
    }
  });

  processUncontrolledOnMount(element, props);

  $element.children = children.map(($child, i) => (
    renderWithVirtual(element, undefined, $child, $element, i)
  ));

  return element;
}

export function remount(
  parentEl: HTMLElement,
  $current: VirtualElement,
  node: Node | undefined,
  componentNextSibling?: ChildNode,
) {
  const isComponent = isComponentElement($current);
  const isFragment = !isComponent && isFragmentElement($current);

  if (isComponent || isFragment) {
    if (isComponent) {
      unmountComponent($current.componentInstance);
    }

    unmountChildren(parentEl, $current);

    if (node) {
      insertBefore(parentEl, node, componentNextSibling);
    }
  } else {
    if (node) {
      parentEl.replaceChild(node, $current.target!);
    } else {
      parentEl.removeChild($current.target!);
    }

    unmountRealTree($current);
  }
}

export function unmountRealTree($element: VirtualElement) {
  if (isComponentElement($element)) {
    unmountComponent($element.componentInstance);
  } else {
    if (isTagElement($element)) {
      if ($element.target) {
        removeAllDelegatedListeners($element.target as HTMLElement);

        if ($element.props.ref?.current === $element.target) {
          $element.props.ref.current = undefined;
        }
      }
    }

    if ($element.target) {
      $element.target = undefined; // Help GC
    }

    if (!isParentElement($element)) {
      return;
    }
  }

  $element.children.forEach(unmountRealTree);
}

export function insertBefore(parentEl: HTMLElement | DocumentFragment, node: Node, nextSibling?: ChildNode) {
  if (nextSibling) {
    parentEl.insertBefore(node, nextSibling);
  } else {
    parentEl.appendChild(node);
  }
}

export function getNextSibling($current: VirtualElement): ChildNode | undefined {
  if (isComponentElement($current) || isFragmentElement($current)) {
    const lastChild = $current.children[$current.children.length - 1];
    return getNextSibling(lastChild);
  }

  const target = $current.target!;
  const {nextSibling} = target;
  return nextSibling || undefined;
}

export function renderChildren(
  $current: VirtualElementParent, $new: VirtualElementParent, currentEl: HTMLElement, nextSibling?: ChildNode,
) {
  if (DEBUG) {
    DEBUG_checkKeyUniqueness($new.children);
  }

  if (('props' in $new) && $new.props.teactFastList) {
    return renderFastListChildren($current, $new, currentEl);
  }

  const currentChildrenLength = $current.children.length;
  const newChildrenLength = $new.children.length;
  const maxLength = Math.max(currentChildrenLength, newChildrenLength);
  const newChildren = [];

  const fragment = newChildrenLength > currentChildrenLength ? document.createDocumentFragment() : undefined;
  const lastCurrentChild = $current.children[currentChildrenLength - 1];
  const fragmentNextSibling = nextSibling || (
    newChildrenLength > currentChildrenLength && lastCurrentChild ? getNextSibling(lastCurrentChild) : undefined
  );

  for (let i = 0; i < maxLength; i++) {
    const $newChild = renderWithVirtual(
      currentEl,
      $current.children[i],
      $new.children[i],
      $new,
      i,
      i >= currentChildrenLength ? {fragment} : {nextSibling},
    );

    if ($newChild) {
      newChildren.push($newChild);
    }
  }

  if (fragment) {
    insertBefore(currentEl, fragment, fragmentNextSibling);
  }

  return newChildren;
}

// This function allows to prepend/append a bunch of new DOM nodes to the top/bottom of preserved ones.
// It also allows to selectively move particular preserved nodes within their DOM list.
function renderFastListChildren($current: VirtualElementParent, $new: VirtualElementParent, currentEl: HTMLElement) {
  const newKeys = new Set(
    $new.children.map(($newChild) => {
      const key = 'props' in $newChild ? $newChild.props.key : undefined;

      if (DEBUG && isParentElement($newChild)) {
        // eslint-disable-next-line no-null/no-null
        if (key === undefined || key === null) {
          // eslint-disable-next-line no-console
          console.warn('Missing `key` in `teactFastList`');
        }

        if (isFragmentElement($newChild)) {
          throw new Error('[Teact] Fragment can not be child of container with `teactFastList`');
        }
      }

      return key;
    }),
  );

  // Build a collection of old children that also remain in the new list
  let currentRemainingIndex = 0;
  const remainingByKey = $current.children
    .reduce((acc, $currentChild, i) => {
      let key = 'props' in $currentChild ? $currentChild.props.key : undefined;
      // eslint-disable-next-line no-null/no-null
      const isKeyPresent = key !== undefined && key !== null;

      // First we process removed children
      if (isKeyPresent && !newKeys.has(key)) {
        renderWithVirtual(currentEl, $currentChild, undefined, $new, -1);

        return acc;
      } else if (!isKeyPresent) {
        const $newChild = $new.children[i];
        const newChildKey = ($newChild && 'props' in $newChild) ? $newChild.props.key : undefined;
        // If a non-key element remains at the same index we preserve it with a virtual `key`
        if ($newChild && !newChildKey) {
          key = `${INDEX_KEY_PREFIX}${i}`;
          // Otherwise, we just remove it
        } else {
          renderWithVirtual(currentEl, $currentChild, undefined, $new, -1);

          return acc;
        }
      }

      // Then we build up info about remaining children
      acc[key] = {
        $element: $currentChild,
        index: currentRemainingIndex++,
        orderKey: 'props' in $currentChild ? $currentChild.props.teactOrderKey : undefined,
      };
      return acc;
    }, {} as Record<string, { $element: VirtualElement; index: number; orderKey?: number }>);

  let newChildren: VirtualElement[] = [];

  let fragmentElements: VirtualElement[] | undefined;
  let fragmentIndex: number | undefined;

  let currentPreservedIndex = 0;

  $new.children.forEach(($newChild, i) => {
    const key = 'props' in $newChild ? $newChild.props.key : `${INDEX_KEY_PREFIX}${i}`;
    const currentChildInfo = remainingByKey[key];

    if (!currentChildInfo) {
      if (!fragmentElements) {
        fragmentElements = [];
        fragmentIndex = i;
      }

      fragmentElements.push($newChild);
      return;
    }

    // This prepends new children to the top
    if (fragmentElements) {
      newChildren = newChildren.concat(renderFragment(fragmentElements, fragmentIndex!, currentEl, $new));
      fragmentElements = undefined;
      fragmentIndex = undefined;
    }

    // Now we check if a preserved node was moved within preserved list
    const newOrderKey = 'props' in $newChild ? $newChild.props.teactOrderKey : undefined;
    // That is indicated by a changed `teactOrderKey` value
    const shouldMoveNode = (
      currentChildInfo.index !== currentPreservedIndex && currentChildInfo.orderKey !== newOrderKey
    );
    const isMovingDown = shouldMoveNode && currentPreservedIndex > currentChildInfo.index;

    if (!shouldMoveNode || isMovingDown) {
      currentPreservedIndex++;
    }

    newChildren.push(
      renderWithVirtual(currentEl, currentChildInfo.$element, $newChild, $new, i, {
        // `+ 1` is needed because before moving down the node still takes place above
        nextSibling: shouldMoveNode ? currentEl.childNodes[isMovingDown ? i + 1 : i] : undefined,
      }),
    );
  });

  // This appends new children to the bottom
  if (fragmentElements) {
    newChildren = newChildren.concat(renderFragment(fragmentElements, fragmentIndex!, currentEl, $new));
  }

  return newChildren;
}

function renderFragment(
  elements: VirtualElement[], fragmentIndex: number, parentEl: HTMLElement, $parent: VirtualElementParent,
) {
  const nextSibling = parentEl.childNodes[fragmentIndex];

  if (elements.length === 1) {
    return [renderWithVirtual(parentEl, undefined, elements[0], $parent, fragmentIndex, {nextSibling})];
  }

  const fragment = document.createDocumentFragment();
  const newChildren = elements.map(($element, i) => (
    renderWithVirtual(parentEl, undefined, $element, $parent, fragmentIndex + i, {fragment})
  ));

  insertBefore(parentEl, fragment, nextSibling);

  return newChildren;
}

function processControlled(tag: string, props: AnyLiteral) {
  const isValueControlled = props.value !== undefined;
  const isCheckedControlled = props.checked !== undefined;
  const isControlled = (isValueControlled || isCheckedControlled) && CONTROLLABLE_TAGS.includes(tag.toUpperCase());
  if (!isControlled) {
    return;
  }

  const {
    value, checked, onInput, onChange,
  } = props;

  props.onChange = undefined;
  props.onInput = (e: ChangeEvent<HTMLInputElement>) => {
    onInput?.(e);
    onChange?.(e);

    if (value !== undefined) {
      const {selectionStart, selectionEnd} = e.currentTarget;

      if (e.currentTarget.value !== value) {
        e.currentTarget.value = value;

        if (selectionStart !== undefined && selectionEnd !== undefined) {
          e.currentTarget.setSelectionRange(selectionStart, selectionEnd);

          // eslint-disable-next-line no-underscore-dangle
          e.currentTarget.dataset.__teactSelectionStart = String(selectionStart);
          // eslint-disable-next-line no-underscore-dangle
          e.currentTarget.dataset.__teactSelectionEnd = String(selectionEnd);
        }
      }
    }

    if (checked !== undefined) {
      e.currentTarget.checked = checked;
    }
  };
}

function processUncontrolledOnMount(element: HTMLElement, props: AnyLiteral) {
  if (!CONTROLLABLE_TAGS.includes(element.tagName)) {
    return;
  }

  if (props.defaultValue) {
    setAttribute(element, 'value', props.defaultValue);
  }

  if (props.defaultChecked) {
    setAttribute(element, 'checked', props.defaultChecked);
  }
}

export function updateAttributes($current: VirtualElementTag, $new: VirtualElementTag, element: HTMLElement) {
  processControlled(element.tagName, $new.props);

  const currentEntries = Object.entries($current.props);
  const newEntries = Object.entries($new.props);

  currentEntries.forEach(([key, currentValue]) => {
    const newValue = $new.props[key];

    if (
      currentValue !== undefined
      && (
        newValue === undefined
        || (currentValue !== newValue && key.startsWith('on'))
      )
    ) {
      removeAttribute(element, key, currentValue);
    }
  });

  newEntries.forEach(([key, newValue]) => {
    const currentValue = $current.props[key];

    if (newValue !== undefined && newValue !== currentValue) {
      setAttribute(element, key, newValue);
    }
  });
}

function setAttribute(element: HTMLElement, key: string, value: any) {
  // An optimization attempt
  if (key === 'className') {
    element.className = value;
    // An optimization attempt
  } else if (key === 'value') {
    if ((element as HTMLInputElement).value !== value) {
      const {
        __teactSelectionStart: selectionStart, __teactSelectionEnd: selectionEnd,
      } = (element as HTMLInputElement).dataset;

      (element as HTMLInputElement).value = value;

      if (selectionStart !== undefined && selectionEnd !== undefined) {
        (element as HTMLInputElement).setSelectionRange(Number(selectionStart), Number(selectionEnd));
      }
    }
  } else if (key === 'style') {
    element.style.cssText = value;
  } else if (key === 'dangerouslySetInnerHTML') {
    // eslint-disable-next-line no-underscore-dangle
    element.innerHTML = value.__html;
  } else if (key.startsWith('on')) {
    addEventListener(element, key, value, key.endsWith('Capture'));
  } else if (key.startsWith('data-') || key.startsWith('aria-') || HTML_ATTRIBUTES.has(key)) {
    element.setAttribute(key, value);
  } else if (!FILTERED_ATTRIBUTES.has(key)) {
    (element as any)[MAPPED_ATTRIBUTES[key] || key] = value;
  }
}

function removeAttribute(element: HTMLElement, key: string, value: any) {
  if (key === 'className') {
    element.className = '';
  } else if (key === 'value') {
    (element as HTMLInputElement).value = '';
  } else if (key === 'style') {
    element.style.cssText = '';
  } else if (key === 'dangerouslySetInnerHTML') {
    element.innerHTML = '';
  } else if (key.startsWith('on')) {
    removeEventListener(element, key, value, key.endsWith('Capture'));
  } else if (key.startsWith('data-') || key.startsWith('aria-') || HTML_ATTRIBUTES.has(key)) {
    element.removeAttribute(key);
  } else if (!FILTERED_ATTRIBUTES.has(key)) {
    delete (element as any)[MAPPED_ATTRIBUTES[key] || key];
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function DEBUG_checkKeyUniqueness(children: VirtualElementChildren) {
  const firstChild = children[0];
  if (firstChild && 'props' in firstChild && firstChild.props.key !== undefined) {
    const keys = children.reduce((acc: any[], child) => {
      if ('props' in child && child.props.key) {
        acc.push(child.props.key);
      }

      return acc;
    }, []);

    if (keys.length !== unique(keys).length) {
      throw new Error('[Teact] Children keys are not unique');
    }
  }
}

const TeactDOM = {render};
export default TeactDOM;
