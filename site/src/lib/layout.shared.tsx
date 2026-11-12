import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Mark } from "@/components/logo";

import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: <Mark className="h-6 w-auto" />,
		},
		githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
	};
}
