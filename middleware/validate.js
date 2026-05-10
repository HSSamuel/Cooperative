export const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  } catch (err) {
    return res.status(400).json({
      message: "Data validation failed",
      errors: err.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
  }
};
