/// <reference lib="dom" />

/**
 * A "good enough" implementation of JSX element types suitable for TypeDoc's
 * output generator.
 * @packageDocumentation
 */

import type { KeysOfType, WritableKeys } from "./general";

export const Fragment = Symbol();

/**
 * Used to inject HTML directly into the document.
 */
export function Raw(_props: { html: string }) {
    // This is handled specially by the renderElement function. Instead of being
    // called, the tag is compared to this function and the `html` prop will be
    // returned directly.
    return null;
}

export type Children = Element | string | null | undefined | Children[];

export type Component<P> = (props: P) => Element | null | undefined;

// Setting these doesn't make sense.
type BannedElementKeys =
    | "dataset"
    | "outerHTML"
    | "innerHTML"
    | "innerText"
    | "textContent"
    | "className"
    | "htmlFor"
    | "style";

type ElementKeys<T> = Exclude<
    WritableKeys<T>,
    BannedElementKeys | KeysOfType<T, Function>
>;

type ElementProps<T> = {
    [K in ElementKeys<T>]?: K extends "children" ? Children : T[K];
} & {
    class?: string;
};

interface SpecialIntrinsicElements {
    label: ElementProps<HTMLLabelElement> & { for?: string };
}

type BasicHtmlElements = {
    [K in Exclude<
        keyof HTMLElementTagNameMap,
        keyof SpecialIntrinsicElements
    >]: ElementProps<HTMLElementTagNameMap[K]>;
};

export interface IntrinsicElements
    extends BasicHtmlElements,
        SpecialIntrinsicElements {}

export interface Element {
    tag: typeof Fragment | keyof IntrinsicElements | Component<any>;
    props: object | null;
    children: Children[];
}