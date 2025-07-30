import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { User } from '@prisma/client';

interface RegisterData {
  email: string;
  password: string;
  name?: string;
  deviceId: string;
}

interface LoginData {
  email: string;
  password: string;
}

export const register = async (data: any): Promise<{ user: Partial<User>; token: string }> => {
  const { email, password, name, deviceId } = data;
  
  // Check if user exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error('Email already in use');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      deviceId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      deviceId: true,
      createdAt: true,
    },
  });

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '24h' }
  );

  return { user, token };
};

export const login = async (data: any): Promise<{ user: Partial<User>; token: string }> => {
  const { email, password } = data;

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      deviceId: true,
      password: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '24h' }
  );

  // Remove password from user object
  const { password: _, ...userWithoutPassword } = user;

  return { user: userWithoutPassword, token };
};