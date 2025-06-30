import { Request } from "express";
import jwt from "jsonwebtoken";

export async function expressAuthentication(
  request: Request,
  securityName: string,
  scopes?: string[]
): Promise<any> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
    };

    // Set userId in request for logging context
    request.userId = parseInt(decoded.id);

    return decoded;
  } catch {
    throw new Error("Invalid or expired token");
  }
}
