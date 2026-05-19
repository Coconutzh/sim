import { describe, expect, it } from "vitest";
import {
	getAddableContentNodePresets,
	getContentNodePreset,
} from "@/lib/product/content-node-presets";

describe("content-node-presets", () => {
	it("creates only text and image content nodes from addable presets", () => {
		const presetIds = getAddableContentNodePresets().map((preset) => preset.id);

		expect(presetIds).toEqual(["text", "image"]);
	});

	it("maps the text preset to a pure canvas content block", () => {
		const preset = getContentNodePreset("text");

		expect(preset).toBeDefined();
		expect(preset?.blockType).toBe("content");
		expect(preset?.contentVariant).toBe("text");
		expect(preset?.presetSubBlockValues).toMatchObject({
			contentVariant: "text",
			contentHtml: "<p></p>",
			blockStyle: "paragraph",
			backgroundColor: "#FFF8C5",
			fontSize: 16,
			width: 320,
			height: 160,
		});
	});

	it("maps the image preset to a pure canvas content block", () => {
		const preset = getContentNodePreset("image");

		expect(preset).toBeDefined();
		expect(preset?.blockType).toBe("content");
		expect(preset?.contentVariant).toBe("image");
		expect(preset?.presetSubBlockValues).toMatchObject({
			contentVariant: "image",
			file: null,
		});
	});
});
