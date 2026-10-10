declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string
        csrfToken: string
      }
    }
  }
}

export {}
