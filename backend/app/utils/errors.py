from fastapi import HTTPException


def not_found(message: str = "Resource not found") -> HTTPException:
    return HTTPException(status_code=404, detail=message)


def forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="You do not have access to this resource")
