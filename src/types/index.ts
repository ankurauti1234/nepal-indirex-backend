export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface UserResponse {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

export interface AuthResponse {
  user: UserResponse;
  token: string;
}

export interface EventResponse {
  id: number;
  deviceId: string;
  timestamp: string;
  type: number;
  details: JSON;
  createdAt: Date;
}