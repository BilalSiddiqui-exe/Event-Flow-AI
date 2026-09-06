from app.firestore.client import db


def hard_delete(document_reference):
    db().recursive_delete(document_reference)