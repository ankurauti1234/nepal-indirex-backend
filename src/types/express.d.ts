// types/express.d.ts
declare namespace Express {
  interface Request {
    user?: {
      id: string;
      email: string;
      name: string | null;
    };
  }
}