import * as assert from "assert";
import { Slugger } from "marked";
import { posix } from "path";
import {
    DeclarationReflection,
    ProjectReflection,
    Reflection,
    ReflectionKind,
} from "../models";

export interface PageTypes {
    markdown: {
        parent: SomePageType;
        markdown: string;
    };
    reflection: DeclarationReflection;
}

export type SomePageType = PageTypes[keyof PageTypes];

/**
 * Type which custom routers must conform to.
 */
export type ThemeRouterConstructor = new (
    project: ProjectReflection
) => ThemeRouter;

/**
 * Defines how to resolve links between reflections and which reflections get their own page.
 */
export class ThemeRouter {
    /**
     * A map of reflections with pages to their associated slugger instance.
     */
    protected _sluggers = new WeakMap<Reflection, Slugger>();
    protected _slugs = new WeakMap<Slugger, WeakMap<Reflection, string>>();

    constructor(protected project: ProjectReflection) {}

    /**
     * Create a link from `from` to `to`, including an anchor if required.
     */
    createLink(from: Reflection, to: Reflection): string {
        const fromPage = this.getDocumentName(from);
        const toPage = this.getDocumentName(to);
        const slug = this.createSlug(to);

        return (
            posix.relative(posix.dirname(fromPage), toPage) +
            (slug ? `#${slug}` : "")
        );
    }

    /**
     * Create a unique anchor for the given reflection or header.
     * Note: Anchors must be case-insensitive unique from all other anchors in the page.
     * This requires that any rendered markdown also use this method to generate a slug.
     * This is correctly handled by the slugger provided by Marked, which is used internally.
     * @param reflection
     */
    createSlug(reflection: Reflection, header?: string): string {
        const targetReflection = reflection;
        const docReflection = this._getReflectionWithDocument(reflection);

        // We have our own page, no anchor required.
        if (docReflection === reflection && !header) {
            return "";
        }

        let slugger = this._sluggers.get(docReflection);
        if (!slugger) {
            slugger = new Slugger();
            // These ids are used in the default page, register them now so that reflections
            // named this don't cause duplicate ids.
            slugger.slug("main");
            slugger.slug("search");
            slugger.slug("theme");
            this._sluggers.set(docReflection, slugger);
        }

        // If this is for a header, always create a new slug.
        if (header) {
            return slugger.slug(header);
        }

        // Include the hierarchy within the anchor.
        const parts: string[] = [];
        while (reflection !== docReflection) {
            // These always have the same name as their parent...
            if (!reflection.kindOf(ReflectionKind.Signature)) {
                parts.unshift(reflection.name);
            }
            assert(reflection.parent);
            reflection = reflection.parent;
        }
        const name = parts.join("-");

        // We should return the same slug for a given reflection / doc reflection whenever it is requested.
        let slugs = this._slugs.get(slugger);
        if (!slugs) {
            slugs = new Map();
            this._slugs.set(slugger, slugs);
        }

        const slug = slugs.get(targetReflection) ?? slugger.slug(name);
        slugs.set(targetReflection, slug);

        return slug;
    }

    /**
     * Creates a link from the page for `from` to the specified asset.
     */
    createAssetLink(from: Reflection, asset: string): string {
        const docReflection = this._getReflectionWithDocument(from);
        const reflectionDir = posix.dirname(
            this.getDocumentName(docReflection)
        );
        return posix.relative(
            reflectionDir,
            posix.join(this.getAssetDirectory(), asset)
        );
    }

    /**
     * Get the directory to store assets in relative to the root theme directory.
     * Used by {@link createAssetLink} to determine how to link to an asset.
     */
    getAssetDirectory(): string {
        return "assets";
    }

    /**
     * Creates a link from the page for `from` to the specified asset.
     */
    createMediaLink(from: Reflection, media: string): string {
        const docReflection = this._getReflectionWithDocument(from);
        const reflectionDir = posix.dirname(
            this.getDocumentName(docReflection)
        );
        return posix.relative(
            reflectionDir,
            posix.join(this.getAssetDirectory(), media)
        );
    }

    /**
     * Get the directory to store media in relative to the root theme directory.
     * Used by {@link createMediaLink} to determine how to link to an asset.
     */
    getMediaDirectory(): string {
        return "media";
    }

    /**
     * Used to get the file name to be written to the file system, may be used
     * even if a reflection does not own its own page.
     *
     * Produces filenames like:
     * mod/ns/class.Foo.html for a class Foo within namespace ns within module mod
     * or
     * mod/ns/index.html for a namespace ns within module mod
     * The kind string in the final filename is important. Without it, reflections which are
     * merged would conflict.
     * ```ts
     * interface Foo {}
     * namespace Foo {} // legal!
     * ```
     *
     * Note: Windows doesn't care if we use / to separate directories, so we can use / here and use
     * the generated names both on the web and to write files.
     *
     * @param reflection
     */
    getDocumentName(reflection: Reflection): string {
        const parts: string[] = [];

        let docReflection = this._getReflectionWithDocument(reflection);
        const pageReflection = docReflection;
        while (docReflection.parent) {
            parts.unshift(this._getSafeFilename(docReflection.name));
            docReflection = docReflection.parent;
        }
        assert(
            docReflection.isProject(),
            "Cannot generate docs for a reflection not in a project."
        );

        if (
            this._anyChildrenHaveOwnDocument(pageReflection) ||
            pageReflection.isProject()
        ) {
            // Our children will be placed under our directory, so we should take index.html.
            return [...parts, "index.html"].join("/");
        }

        const fileName = `${ReflectionKind.toKindString(
            pageReflection.kind
        )}.${this._getSafeFilename(pageReflection.name)}.html`;
        parts.pop(); // Skip project directory
        return [...parts, fileName].join("/");
    }

    /**
     * Used to determine if a reflection should get its own page, or be contained within its parent's page.
     *
     * Rules:
     * 1. If `false` is returned for a reflection, all children reflections must also return `false`.
     * 2. If `true` is returned for a reflection, its children may return `true` or `false`.
     * 3. `true` must be returned for {@link ProjectReflection | ProjectReflections}
     */
    hasOwnDocument(reflection: Reflection): boolean {
        return reflection.kindOf(
            ReflectionKind.Project |
                ReflectionKind.Module |
                ReflectionKind.Namespace |
                ReflectionKind.Class |
                ReflectionKind.Interface
        );
    }

    /**
     * Helper function for templates to get direct children which should be rendered in this page.
     * @param reflection
     */
    getChildrenInPage(reflection: Reflection): Reflection[] {
        return reflection.isContainer()
            ? reflection.children?.filter(
                  (child) => !this.hasOwnDocument(child)
              ) ?? []
            : [];
    }

    /**
     * Helper function for templates to get direct children which should be rendered in a separate page.
     * @param reflection
     */
    getChildrenNotInPage(reflection: Reflection): Reflection[] {
        return reflection.isContainer()
            ? reflection.children?.filter((child) =>
                  this.hasOwnDocument(child)
              ) ?? []
            : [];
    }

    /**
     * Helper function to find the reflection whose page this reflection will be contained in.
     */
    protected _getReflectionWithDocument(reflection: Reflection): Reflection {
        while (!this.hasOwnDocument(reflection)) {
            assert(
                reflection.parent,
                `Rendered reflection ${reflection.name} has no parent with document.`
            );
            reflection = reflection.parent;
        }
        return reflection;
    }

    /**
     * Transform the given filename into a safe filename, replacing special characters.
     */
    protected _getSafeFilename(name: string): string {
        // POSIX: Fully portable filenames https://en.wikipedia.org/wiki/Filename
        return name.replace(/[^A-Za-z0-9._-]|^-/g, "_");
    }

    /**
     * Helper to determine if the given reflection is going to be a directory.
     */
    protected _anyChildrenHaveOwnDocument(reflection: Reflection): boolean {
        if (reflection.isContainer()) {
            return (
                reflection.children?.some((child) =>
                    this.hasOwnDocument(child)
                ) ?? false
            );
        }
        return false;
    }
}

export class MinimalThemeRouter extends ThemeRouter {
    hasOwnDocument(reflection: Reflection): boolean {
        return reflection.isProject();
    }
}