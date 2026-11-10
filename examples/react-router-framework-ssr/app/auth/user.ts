import { z } from "zod";

/**
 * The user, from DummyJSON's login response. `z.object` drops the fields it
 * doesn't list, such as the tokens.
 */
export const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	firstName: z.string(),
	lastName: z.string(),
	image: z.string(),
});

export type User = z.infer<typeof userSchema>;
