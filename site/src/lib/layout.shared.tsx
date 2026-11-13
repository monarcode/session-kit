import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "@/components/logo";

import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: <Logo className="h-5 w-auto" />,
		},
		// The site is dark only.
		themeSwitch: { enabled: false },
		githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
	};
}
