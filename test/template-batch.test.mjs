/* Template Batching in TINQ is roughly analagous to "meta templates" in Yatte. It's a way to assemble one template
   that refers to multiple other templates, and have the result of this one template be a LIST of documents
   rather than a single document. This works for plain text documents as well as binary formats that must be
   produced asynchronously/out-of-band.
*/