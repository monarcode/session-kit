"use client";
import { useLocation } from "@tanstack/react-router";
import { useStaticSearch } from "fumadocs-core/search/client";
import {
	SearchDialog,
	SearchDialogClose,
	SearchDialogContent,
	SearchDialogHeader,
	SearchDialogIcon,
	SearchDialogInput,
	SearchDialogList,
	SearchDialogOverlay,
	type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useI18n } from "fumadocs-ui/contexts/i18n";

import { versionOfUrl } from "@/lib/shared";

export default function DefaultSearchDialog(props: SharedProps) {
	const { locale } = useI18n(); // (optional) for i18n
	const { pathname } = useLocation();
	// Search the release line being read.
	const search = useStaticSearch({ locale, tag: versionOfUrl(pathname) });

	return (
		<SearchDialog {...search} {...props}>
			<SearchDialogOverlay />
			<SearchDialogContent>
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput />
					<SearchDialogClose />
				</SearchDialogHeader>
				<SearchDialogList />
			</SearchDialogContent>
		</SearchDialog>
	);
}
